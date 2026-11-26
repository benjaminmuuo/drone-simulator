/**
 * Hardware test page (spike/hardware.html). Not part of the app build.
 * Flies the one test being worked on through DroneRunner and collects each
 * flight's numbers, the observer's notes and the full log into a shareable report.
 */
import { describeCommand } from '../parser/describeCommand';
import type { DroneCommand } from '../parser/types';
import { DroneRunner } from './DroneRunner';
import type { Calibration, Measurement } from './DroneRunner';
import { clearCalibration, loadCalibration } from './calibrationStore';
import { FLOOR_CALIBRATION, realCm } from './floorCalibration';
import type { Trim } from './protocol';
import { TRIM_RULES, nextTrim } from './trim';
import { SerialLink, isWebSerialSupported } from './SerialLink';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  connect: $<HTMLButtonElement>('connect'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  flyButtons: $('fly-buttons'),
  abort: $<HTMLButtonElement>('abort'),
  stop: $<HTMLButtonElement>('stop'),
  warning: $('warning'),
  trimNow: $('trim-now'),
  trimRound: $<HTMLButtonElement>('trim-round'),
  trimReset: $<HTMLButtonElement>('trim-reset'),
  calibration: $('calibration'),
  flights: $('flights'),
  measure: $('measure'),
  notes: $<HTMLTextAreaElement>('notes'),
  copyReport: $<HTMLButtonElement>('copy-report'),
  downloadReport: $<HTMLButtonElement>('download-report'),
  reportText: $<HTMLTextAreaElement>('report-text'),
  clear: $<HTMLButtonElement>('clear'),
  resetCalibration: $<HTMLButtonElement>('reset-calibration'),
  log: $('log'),
};

/* ---------- The current test ---------- */

const TEST_DISTANCES_CM = [60, 120, 180] as const;
/** Shared with the app. Distance learning is off here too: it trusts the drone's sensor, which under-reads on this floor. */
const TAPE_SCALE = FLOOR_CALIBRATION.distanceScale;
const correctedCm = realCm;
const TURN_AIM_SHORT_DEG = FLOOR_CALIBRATION.turnAimShortDeg;
/**
 * Two-leg route from the middle of the bottom-LEFT box (30, 198): forward to (30, 38), turn right,
 * forward to (270, 38). From the bottom-right box the second leg would leave the floor.
 * A good landing is 38 cm from the far edge and 30 cm from the right edge.
 */
type EdgeField = 'tapeFarEdgeCm' | 'tapeRightEdgeCm' | 'tapeNearEdgeCm' | 'tapeLeftEdgeCm';
interface RouteDef {
  readonly id: 'two-sides' | 'perimeter';
  readonly title: string;
  readonly legsCm: readonly number[];
  /** Turn right once more after the last leg, so the nose faces the way it started. */
  readonly finalTurn: boolean;
  /** Where a perfect landing sits, measured from two floor edges. Closer to the edge than perfect = leg too far. */
  readonly edges: readonly [RouteEdge, RouteEdge];
}
interface RouteEdge {
  readonly field: EdgeField;
  readonly name: string;
  readonly leg: string;
  readonly perfectCm: number;
}
const TWO_SIDES: RouteDef = {
  id: 'two-sides',
  title: 'forward 160, right 90°, forward 240 cm',
  legsCm: [160, 240],
  finalTurn: false,
  edges: [
    { field: 'tapeFarEdgeCm', name: 'far', leg: 'first leg', perfectCm: 38 },
    { field: 'tapeRightEdgeCm', name: 'right', leg: 'second leg', perfectCm: 30 },
  ],
};
/**
 * Full lap from the middle of the bottom-left box (30, 198): (30, 38), (270, 38), (270, 198), back to the
 * start, turning right at every corner. A perfect landing is 22 cm from the near edge and 30 cm from the left edge.
 */
const PERIMETER: RouteDef = {
  id: 'perimeter',
  title: 'full perimeter: 160, right, 240, right, 160, right, 240, right',
  legsCm: [160, 240, 160, 240],
  finalTurn: true,
  edges: [
    { field: 'tapeNearEdgeCm', name: 'near', leg: 'third leg', perfectCm: 22 },
    { field: 'tapeLeftEdgeCm', name: 'left', leg: 'last leg', perfectCm: 30 },
  ],
};
const T: DroneCommand = { type: 'TAKEOFF', blockId: null };
const L: DroneCommand = { type: 'LAND', blockId: null };
/** Route flights settle after take-off and before every turn. */
const ROUTE_TAKEOFF_HOVER_S = 3;
const ROUTE_TURN_HOVER_S = 1.5;
const routeProgram = (route: RouteDef, sentCm: readonly number[]): readonly DroneCommand[] => [
  T,
  { type: 'HOVER', durationSeconds: ROUTE_TAKEOFF_HOVER_S, blockId: null },
  ...sentCm.flatMap((distanceCm, i): DroneCommand[] => [
    { type: 'MOVE', direction: 'FORWARD', distanceCm, blockId: null },
    ...(i < sentCm.length - 1 || route.finalTurn
      ? ([
          { type: 'HOVER', durationSeconds: ROUTE_TURN_HOVER_S, blockId: null },
          { type: 'TURN', direction: 'RIGHT', degrees: 90, blockId: null },
        ] as DroneCommand[])
      : []),
  ]),
  L,
];
const testProgram = (cm: number): readonly DroneCommand[] => [
  T,
  { type: 'HOVER', durationSeconds: 2, blockId: null },
  { type: 'MOVE', direction: 'FORWARD', distanceCm: cm, blockId: null },
  L,
];

/* ---------- Saved between page reloads ---------- */

const FLIGHTS_KEY = 'birds.hardwareTest.flights.v1';
const LOG_KEY = 'birds.hardwareTest.log.v1';
const NOTES_KEY = 'birds.hardwareTest.notes.v1';
const MAX_LOG_LINES = 4000;

function read<V>(key: string, fallback: V): V {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === null ? fallback : (JSON.parse(saved) as V);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered across reloads; the page still works.
  }
}

interface FlightRecord {
  readonly at: string;
  readonly outcome: string;
  /** Why it failed, when it did. */
  readonly message?: string;
  readonly batteryPct: number | null;
  readonly calibration: Calibration;
  readonly measurements: Measurement[];
  /** Where it should land (flights saved before the 60/120 cm tests were all 180 cm). */
  readonly distanceCm?: number;
  /** The distance actually put in the program, after the tape correction. */
  readonly commandCm?: number;
  /** Tape-measured by the observer: slide during take-off, and start mark to landing spot. */
  readonly tapeTakeoffCm?: number | undefined;
  readonly tapeLandedCm?: number | undefined;
  /** Route flights only: which route, the distances sent, and the landing measured from the floor edges. */
  readonly routeId?: RouteDef['id'];
  readonly routeSentCm?: readonly number[];
  readonly tapeFarEdgeCm?: number | undefined;
  readonly tapeRightEdgeCm?: number | undefined;
  readonly tapeNearEdgeCm?: number | undefined;
  readonly tapeLeftEdgeCm?: number | undefined;
}

const TAPE_FIELDS = ['tapeLandedCm', 'tapeTakeoffCm', 'tapeFarEdgeCm', 'tapeRightEdgeCm', 'tapeNearEdgeCm', 'tapeLeftEdgeCm'] as const;
type TapeField = (typeof TAPE_FIELDS)[number];

let flights: FlightRecord[] = read<FlightRecord[]>(FLIGHTS_KEY, []);
let logLines: string[] = read<string[]>(LOG_KEY, []);
let logSaveTimer: number | undefined;
ui.notes.value = read<string>(NOTES_KEY, '');
ui.log.textContent = logLines.length ? `${logLines.join('\n')}\n` : '';

function saveLog() {
  window.clearTimeout(logSaveTimer);
  logSaveTimer = undefined;
  write(LOG_KEY, logLines);
}

function log(msg: string) {
  const line = `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) {
    logLines = logLines.slice(-MAX_LOG_LINES);
    ui.log.textContent = `${logLines.join('\n')}\n`;
  } else {
    ui.log.append(`${line}\n`);
  }
  ui.log.scrollTop = ui.log.scrollHeight;
  logSaveTimer ??= window.setTimeout(saveLog, 1000);
}

/* ---------- Flight numbers ---------- */

const r0 = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : '–');
const r1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const askedCm = (f: FlightRecord) => f.distanceCm ?? 180;
const commandOf = (f: FlightRecord) => f.commandCm ?? askedCm(f);
/** How far the tape-measured landing was from the target. */
const missText = (miss: number) => (miss === 0 ? 'on target' : `${Math.abs(miss)} cm too ${miss > 0 ? 'far' : 'short'}`);
const routeOf = (f: FlightRecord) => (f.routeSentCm ? (f.routeId === 'perimeter' ? PERIMETER : TWO_SIDES) : null);
const isMeasured = (f: FlightRecord) => {
  const route = routeOf(f);
  return route ? route.edges.every((e) => f[e.field] !== undefined) : f.tapeLandedCm !== undefined;
};
function tapeMiss(f: FlightRecord): string {
  if (!isMeasured(f)) return 'not measured yet';
  const route = routeOf(f);
  if (route) return route.edges.map((e) => `${e.leg} ${missText(Math.round(e.perfectCm - (f[e.field] as number)))}`).join(', ');
  return missText(Math.round((f.tapeLandedCm as number) - askedCm(f)));
}

const tapeText = (cm: number | undefined) => (cm === undefined ? 'not measured' : `${cm} cm`);
const landedText = (f: FlightRecord) => {
  const route = routeOf(f);
  return route
    ? route.edges.map((e) => `${tapeText(f[e.field])} from ${e.name} edge`).join(', ')
    : `${tapeText(f.tapeLandedCm)} from the start mark`;
};
const targetText = (f: FlightRecord) => routeOf(f)?.title ?? `${askedCm(f)} cm`;
const sentText = (f: FlightRecord) => (f.routeSentCm ? `${f.routeSentCm.join(', right, ')} cm` : `${commandOf(f)} cm`);

/** One flight's measurements as short display strings. */
function flightNumbers(f: FlightRecord) {
  const find = <K extends Measurement['kind']>(kind: K) =>
    f.measurements.find((m): m is Extract<Measurement, { kind: K }> => m.kind === kind);
  const moves = f.measurements.filter((m): m is Extract<Measurement, { kind: 'move' }> => m.kind === 'move');
  const sides = moves.flatMap((m) => (m.maxSideCm === null ? [] : [m.maxSideCm]));
  const turns = f.measurements.filter((m): m is Extract<Measurement, { kind: 'turn' }> => m.kind === 'turn');
  const hover = find('hover');
  const end = find('end');
  const dropouts = f.measurements.filter((m): m is Extract<Measurement, { kind: 'dropout' }> => m.kind === 'dropout');
  return {
    flown: moves.length ? `${moves.map((m) => `${r0(m.movedCm)} of ${m.askedCm}`).join(', then ')} cm` : '–',
    side: sides.length ? `${r0(Math.max(...sides))} cm` : '–',
    turn: turns.length ? `${turns.map((t) => `${r0(t.turnedDeg)}°`).join(', ')} of 90°` : '–',
    // Saved flights from before height was recorded have no heightCm.
    heights: (() => {
      const cm = f.measurements.flatMap((m) =>
        m.kind === 'hover' && Number.isFinite(m.heightCm)
          ? [`${r0(m.heightCm)}${m.heightFixCm ? ` (moved ${m.heightFixCm > 0 ? 'up' : 'down'} ${r0(Math.abs(m.heightFixCm))})` : ''}`]
          : [],
      );
      return cm.length ? `${cm.join(', ')} cm` : '–';
    })(),
    end: end ? `${r0(end.offCm)} cm (forward ${r0(end.forwardCm)}, left ${r0(end.leftCm)})` : '–',
    hover: hover ? `forward ${r0(hover.forwardCm)}, right ${r0(hover.rightCm)} cm in ${r1(hover.seconds)} s` : '–',
    dropouts: dropouts.length
      ? `${dropouts.length} (${dropouts.filter((d) => d.recovered).length} recovered, longest ${r1(Math.max(...dropouts.map((d) => d.seconds)))} s)`
      : 'none',
  };
}

const calibrationText = (c: Calibration) =>
  `turns aim ${c.overshootDeg.toFixed(1)}° short; distance ratio ${c.moveRatio.toFixed(3)}, after a turn ${c.moveRatioAfterTurn.toFixed(3)}`;

function renderFlights() {
  ui.calibration.textContent = `Calibration now: ${calibrationText(runner?.calibration ?? loadCalibration())}`;
  if (flights.length === 0) {
    ui.measure.innerHTML = '<p class="hint">Fly once and a card appears here.</p>';
    ui.flights.innerHTML = '<p class="hint">No flights yet.</p>';
    return;
  }
  const field = (f: FlightRecord, i: number, name: TapeField, title: string, help: string, example: string) =>
    `<label>${title}<small>${help}</small>` +
    `<input type="number"${name.endsWith('EdgeCm') ? '' : ' min="0"'} step="1" placeholder="${example}" ` +
    `data-flight="${i}" data-field="${name}" value="${f[name] ?? ''}" /> cm</label>`;
  const takeoffField = (f: FlightRecord, i: number, n: number) =>
    field(f, i, 'tapeTakeoffCm', `${n}. How far did it slide during take-off? (optional)`, 'From the start mark to where it was hovering, before it flew forward. Type 0 if it stayed put. Leave empty if you did not see.', 'e.g. 5');
  const fields = (f: FlightRecord, i: number) => {
    const route = routeOf(f);
    if (!route)
      return (
        field(f, i, 'tapeLandedCm', '1. Where did it land?', 'Tape from the start mark straight to the middle of the drone.', `e.g. ${askedCm(f)}`) +
        takeoffField(f, i, 2)
      );
    const edgeFields = route.edges.map((e, n) =>
      field(f, i, e.field, `${n + 1}. Distance from the ${e.name} edge`, `Tape from the ${e.name} edge to the middle of the drone. A perfect landing is ${e.perfectCm} cm. If it landed past the edge, type a minus number.`, `e.g. ${e.perfectCm}`),
    );
    return edgeFields.join('') + takeoffField(f, i, 3);
  };
  ui.measure.innerHTML = flights
    .map(
      (f, i) =>
        `<section class="measure-card${isMeasured(f) ? '' : ' needs'}" data-card="${i}">` +
        `<h3>Flight ${i + 1}: ${f.routeSentCm ? `route, ${targetText(f)}` : `should land ${askedCm(f)} cm from the start mark`}</h3>` +
        fields(f, i) +
        `<p class="measure-result">Result: <span data-miss="${i}">${tapeMiss(f)}</span></p></section>`,
    )
    .reverse()
    .join('');
  const rows = flights.map((f, i) => {
    const n = flightNumbers(f);
    const result = f.message ? `${f.outcome}: ${f.message}` : f.outcome;
    return (
      `<tr><td>${i + 1}</td><td>${escapeHtml(f.at)}</td><td>${targetText(f)}</td><td>${sentText(f)}</td><td>${escapeHtml(result)}</td>` +
      `<td data-landed="${i}">${landedText(f)}</td><td data-miss="${i}">${tapeMiss(f)}</td>` +
      `<td>${n.flown}</td><td>${n.turn}</td><td>${n.heights}</td><td>${n.side}</td><td>${n.end}</td><td>${n.hover}</td><td>${n.dropouts}</td></tr>`
    );
  });
  ui.flights.innerHTML =
    '<table><thead><tr><th>#</th><th>Time</th><th>Target</th><th>Sent</th><th>Result</th><th>Landed (tape)</th><th>Miss</th>' +
    '<th>Drone says it flew</th><th>Turn</th><th>Height at each hover</th><th>Off the line</th>' +
    `<th>End vs target</th><th>Hover drift</th><th>Dropouts</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** Everything needed to review the test, as plain text to paste back. */
function reportText(): string {
  const s = runner?.status;
  const lines = [
    'CoDrone EDU hardware test report',
    `Generated: ${new Date().toISOString()}`,
    `Test: land at ${TEST_DISTANCES_CM.join(' / ')} cm, or a route (two sides, or the full perimeter), using the tape correction on the black surface (sends target ÷ ${TAPE_SCALE}); landings checked with a tape measure`,
    'Floor: 300 cm long × 220 cm wide, 5 × 5 boxes (60 × 44 cm). Start: middle of the bottom-right box (route: bottom-left box), nose across the width.',
    `Battery now: ${s ? `${s.battery}%` : 'not connected'}`,
    `${ui.trimNow.textContent ?? ''}`,
    `Calibration now: ${calibrationText(runner?.calibration ?? loadCalibration())}`,
    '',
    'What I saw:',
    ui.notes.value.trim() || '(no notes)',
    '',
    `Flights (${flights.length}):`,
  ];
  flights.forEach((f, i) => {
    const n = flightNumbers(f);
    lines.push(
      `${i + 1}. ${f.at} target ${targetText(f)}, program sent ${sentText(f)}; ${f.outcome}${f.message ? ` (${f.message})` : ''}; ` +
        `TAPE landed ${landedText(f)} (${tapeMiss(f)}), take-off slide ${tapeText(f.tapeTakeoffCm)}; ` +
        `battery at start ${f.batteryPct ?? '?'}%; drone says flown ${n.flown}; turn ${n.turn}; height at each hover ${n.heights}; ` +
        `off the line ${n.side}; end vs target ${n.end}; hover drift ${n.hover}; dropouts ${n.dropouts}; ` +
        `calibration before flight: ${calibrationText(f.calibration)}`,
    );
  });
  lines.push('', 'Full log:', ...logLines);
  return lines.join('\n');
}

/* ---------- Connection and flying ---------- */

let link: SerialLink | null = null;
let runner: DroneRunner | null = null;
let ageTimer: number | undefined;

function render() {
  const s = runner?.status ?? null;
  $('s-link').textContent = link ? (runner?.isAnswering ? 'Connected, drone answering' : 'Connected, drone not answering') : 'Not connected';
  $('s-system').textContent = s?.system ?? '–';
  $('s-flight').textContent = s ? `${s.flight} / ${s.movement}` : '–';
  $('s-battery').textContent = s ? `${s.battery}%` : '–';
  $('s-rejected').textContent = link ? String(link.rejectedPackets) : '–';

  const idle = link !== null && runner !== null && !runner.isRunning;
  ui.connect.disabled = link !== null;
  ui.disconnect.disabled = link === null || runner?.isRunning === true;
  ui.flyButtons.querySelectorAll('button').forEach((b) => (b.disabled = !idle));
  ui.trimRound.disabled = !idle;
  ui.trimReset.disabled = !idle;
  ui.resetCalibration.disabled = runner?.isRunning === true;
  ui.abort.disabled = link === null;
  ui.stop.disabled = link === null;
}

function showWarning(message: string | null) {
  ui.warning.hidden = message === null;
  ui.warning.textContent = message ?? '';
  if (message) log(`⚠ ${message}`);
}

async function fly(targetCm: number, route?: RouteDef) {
  if (!runner) return;
  const commandCm = correctedCm(targetCm);
  const routeSentCm = route?.legsCm.map(correctedCm);
  const program = route && routeSentCm ? routeProgram(route, routeSentCm) : testProgram(commandCm);
  runner.moveRatio = 1;
  runner.moveRatioAfterTurn = 1;
  runner.overshootDeg = TURN_AIM_SHORT_DEG;
  showWarning(null);
  log(
    route && routeSentCm
      ? `▶ Route from the bottom-left box (${route.title}): take off, hover ${ROUTE_TAKEOFF_HOVER_S} s, sends ${routeSentCm.join(', right, ')} cm${route.finalTurn ? ', right' : ''}, hovering ${ROUTE_TURN_HOVER_S} s before each turn, land (${calibrationText(runner.calibration)})`
      : `▶ Target ${targetCm} cm: take off, hover 2 s, forward ${commandCm} cm (tape-corrected), land (${calibrationText(runner.calibration)})`,
  );
  const started = Date.now();
  const calibration = runner.calibration;
  const batteryPct = runner.status?.battery ?? null;
  const measurements: Measurement[] = [];
  const run = runner.run(program, {
    onStep: (i, c) => log(`  [${i + 1}/${program.length}] ${describeCommand(c)}`),
    onLog: (m) => log(`    ${m}`),
    onMeasure: (m) => {
      measurements.push(m);
      log(`    measured: ${JSON.stringify(m)}`);
    },
    onWarning: showWarning,
  });
  render();
  const outcome = await run;
  if (runner) {
    runner.moveRatio = 1;
    runner.moveRatioAfterTurn = 1;
  }
  flights.push({
    at: new Date().toTimeString().slice(0, 8),
    outcome: outcome.status.toLowerCase(),
    ...(outcome.status === 'FAILED' ? { message: outcome.message } : {}),
    batteryPct,
    calibration,
    measurements,
    distanceCm: targetCm,
    commandCm,
    ...(route && routeSentCm ? { routeId: route.id, routeSentCm } : {}),
  });
  write(FLIGHTS_KEY, flights);
  renderFlights();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.status === 'FAILED')
    log(`✗ ${outcome.message}${outcome.commandIndex !== null ? ` (block ${outcome.commandIndex + 1})` : ''}`);
  else log(`${outcome.status === 'COMPLETED' ? '✓' : '■'} ${outcome.status.toLowerCase()} after ${secs} s`);
  saveLog();
  render();
}

async function connect() {
  try {
    link = await SerialLink.request();
  } catch (e) {
    log(`✗ connect: ${(e as Error).message}`);
    return;
  }
  log('✓ port open at 57600 baud');
  runner = new DroneRunner(link, loadCalibration());
  runner.learnDistance = false;
  runner.holdHeight = true;
  let lastFlight = '';
  runner.onStatus((s) => {
    const key = `${s.system} / ${s.flight} / ${s.movement}`;
    if (key !== lastFlight) log(`  state: ${key} / ${s.battery}%`);
    lastFlight = key;
  });
  void link.done.then(() => {
    if (link) {
      log('✗ controller disconnected');
      cleanup();
    }
  });
  ageTimer = window.setInterval(render, 250);
  render();
  // Show the drone's current trim once it answers.
  window.setTimeout(() => void readTrimNow(), 1000);
}

function cleanup() {
  window.clearInterval(ageTimer);
  runner?.dispose();
  runner = null;
  link = null;
  render();
}

async function disconnect() {
  const l = link;
  cleanup();
  await l?.close();
  log('port closed');
}

/* ---------- Trim ---------- */

const showTrim = (t: Trim | null) => {
  ui.trimNow.textContent = t ? `Trim: roll ${t.roll}, pitch ${t.pitch}` : 'Trim: not read';
};

async function readTrimNow(): Promise<Trim | null> {
  const t = (await runner?.readTrim()) ?? null;
  showTrim(t);
  return t;
}

/** One round: hover 5 s, measure the drift, step the trim against it. */
async function trimRound() {
  if (!runner) return;
  const before = await readTrimNow();
  if (!before) {
    log('✗ could not read the trim from the drone');
    return;
  }
  let hover: Extract<Measurement, { kind: 'hover' }> | null = null;
  log(`▶ trim round (trim now roll ${before.roll}, pitch ${before.pitch})`);
  const outcome = await runner.run([T, { type: 'HOVER', durationSeconds: 5, blockId: null }, L], {
    onLog: (m) => log(`    ${m}`),
    onMeasure: (m) => {
      if (m.kind === 'hover') hover = m;
    },
    onWarning: showWarning,
  });
  render();
  const h = hover as Extract<Measurement, { kind: 'hover' }> | null;
  if (outcome.status !== 'COMPLETED' || !h) {
    log(`✗ trim round not finished (${outcome.status === 'FAILED' ? outcome.message : outcome.status.toLowerCase()}); trim unchanged`);
    return;
  }
  const drift = { forwardCmPerS: h.forwardCm / h.seconds, rightCmPerS: h.rightCm / h.seconds };
  log(`  drift: ${r1(drift.forwardCmPerS)} cm/s forward, ${r1(drift.rightCmPerS)} cm/s right`);
  const round = nextTrim(before, drift);
  if (round.holdingStill) {
    log(`✓ holding still (under ${TRIM_RULES.deadbandCmPerS} cm/s each way): trim stays roll ${before.roll}, pitch ${before.pitch}`);
    return;
  }
  const after = await runner.setTrim(round.trim);
  showTrim(after);
  log(
    after && after.roll === round.trim.roll && after.pitch === round.trim.pitch
      ? `✓ trim set: roll ${before.roll} → ${after.roll}, pitch ${before.pitch} → ${after.pitch}. Put the drone back and run another round.`
      : `✗ trim not confirmed by the drone (read back ${after ? `roll ${after.roll}, pitch ${after.pitch}` : 'nothing'})`,
  );
}

ui.trimRound.onclick = async () => {
  ui.trimRound.disabled = true;
  try {
    await trimRound();
  } finally {
    render();
  }
};
ui.trimReset.onclick = async () => {
  if (!runner || !window.confirm('Set the drone\'s roll and pitch trim back to 0?')) return;
  const before = await readTrimNow();
  const after = await runner.setTrim({ roll: 0, pitch: 0, yaw: before?.yaw ?? 0, throttle: before?.throttle ?? 0 });
  showTrim(after);
  log(after && after.roll === 0 && after.pitch === 0 ? '✓ trim reset to 0' : '✗ trim reset not confirmed');
};

/* ---------- Report and page controls ---------- */

ui.notes.oninput = () => write(NOTES_KEY, ui.notes.value);

// Tape measurements typed into a flight's card.
ui.measure.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const index = Number(input.dataset.flight);
  const field = input.dataset.field;
  const flight = flights[index];
  if (!flight || !TAPE_FIELDS.includes(field as TapeField)) return;
  const value = input.valueAsNumber;
  const allowed = Number.isFinite(value) && (value >= 0 || field?.endsWith('EdgeCm') === true);
  const updated: FlightRecord = { ...flight, [field as TapeField]: allowed ? value : undefined };
  flights[index] = updated;
  write(FLIGHTS_KEY, flights);
  document.querySelectorAll(`[data-miss="${index}"]`).forEach((el) => (el.textContent = tapeMiss(updated)));
  document.querySelectorAll(`[data-landed="${index}"]`).forEach((el) => (el.textContent = landedText(updated)));
  document.querySelector(`[data-card="${index}"]`)?.classList.toggle('needs', !isMeasured(updated));
});

ui.copyReport.onclick = async () => {
  const text = reportText();
  try {
    await navigator.clipboard.writeText(text);
    ui.reportText.hidden = true;
    log('✓ report copied to the clipboard');
  } catch {
    // Clipboard blocked: show the text to copy by hand.
    ui.reportText.hidden = false;
    ui.reportText.value = text;
    ui.reportText.select();
  }
};
ui.downloadReport.onclick = () => {
  const url = URL.createObjectURL(new Blob([reportText()], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `drone-test-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};
ui.clear.onclick = () => {
  if (!window.confirm('Clear all flights, notes and the log on this page?')) return;
  flights = [];
  logLines = [];
  ui.log.textContent = '';
  ui.notes.value = '';
  ui.reportText.hidden = true;
  write(FLIGHTS_KEY, flights);
  write(NOTES_KEY, '');
  saveLog();
  renderFlights();
};
ui.resetCalibration.onclick = () => {
  if (!window.confirm('Forget what the drone has learned (turn overshoot and distance ratio)? Do this when switching to a different drone.')) return;
  clearCalibration();
  if (runner) {
    const fresh = loadCalibration();
    runner.overshootDeg = fresh.overshootDeg;
    runner.moveRatio = fresh.moveRatio;
    runner.moveRatioAfterTurn = fresh.moveRatioAfterTurn;
  }
  log('calibration reset to defaults');
  renderFlights();
};

if (!isWebSerialSupported()) $('unsupported').hidden = false;

for (const cm of TEST_DISTANCES_CM) {
  const b = document.createElement('button');
  b.textContent = `Land at ${cm} cm (sends ${correctedCm(cm)} cm)`;
  b.disabled = true;
  b.onclick = () => void fly(cm);
  ui.flyButtons.append(b);
}
for (const [route, label] of [
  [TWO_SIDES, 'Two sides from bottom-LEFT box: forward 160, right, forward 240'],
  [PERIMETER, 'Full perimeter from bottom-LEFT box: 160, 240, 160, 240, turning right'],
] as const) {
  const b = document.createElement('button');
  b.className = 'route';
  b.textContent = `${label} (sends ${[...new Set(route.legsCm.map(correctedCm))].join(' and ')} cm)`;
  b.disabled = true;
  b.onclick = () => void fly(route.legsCm[0] as number, route);
  ui.flyButtons.append(b);
}
ui.connect.onclick = () => void connect();
ui.disconnect.onclick = () => void disconnect();
ui.abort.onclick = () => {
  log('■ abort: landing');
  void runner?.abort();
};
ui.stop.onclick = () => {
  log('■ STOP: motors off');
  void runner?.emergencyStop();
};

window.addEventListener('keydown', (e) => {
  // Space stays a normal key while typing notes or numbers, unless the drone is in the air.
  const typing = e.target === ui.notes || e.target instanceof HTMLInputElement;
  if (e.code === 'Space' && link && (!typing || runner?.isRunning)) {
    e.preventDefault();
    ui.stop.click();
  }
});

// Leaving the page mid-flight: land rather than leave the drone flying.
const landIfFlying = () => {
  if (runner?.isRunning) void runner.abort();
};
window.addEventListener('pagehide', () => {
  landIfFlying();
  saveLog();
});
document.addEventListener('visibilitychange', () => document.hidden && landIfFlying());

render();
renderFlights();
