/**
 * Hardware test page (spike/hardware.html). Not part of the app build.
 * Flies small test programs through DroneRunner so moves, turns and the
 * safety paths can be checked on a real drone, and collects calibration
 * results (Flight School lessons flown many times) into a summary table.
 */
import { MAZES } from '../mazes';
import { LESSONS } from '../mazes/lessons';
import { describeCommand } from '../parser/describeCommand';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand } from '../parser/types';
import { DroneRunner } from './DroneRunner';
import type { Calibration, Measurement } from './DroneRunner';
import { clearCalibration, loadCalibration, saveCalibration } from './calibrationStore';
import { SerialLink, isWebSerialSupported } from './SerialLink';
import { DataType, toHex } from './protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  connect: $<HTMLButtonElement>('connect'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  programs: $('programs'),
  xml: $<HTMLTextAreaElement>('xml'),
  runXml: $<HTMLButtonElement>('run-xml'),
  abort: $<HTMLButtonElement>('abort'),
  stop: $<HTMLButtonElement>('stop'),
  raw: $<HTMLInputElement>('raw'),
  headingTurns: $<HTMLInputElement>('heading-turns'),
  lessons: $('lessons'),
  calibration: $('calibration'),
  results: $('results'),
  resultsText: $<HTMLTextAreaElement>('results-text'),
  copyResults: $<HTMLButtonElement>('copy-results'),
  clearResults: $<HTMLButtonElement>('clear-results'),
  resetCalibration: $<HTMLButtonElement>('reset-calibration'),
  log: $('log'),
};

const T: DroneCommand = { type: 'TAKEOFF', blockId: null };
const L: DroneCommand = { type: 'LAND', blockId: null };
const move = (direction: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT', distanceCm: number): DroneCommand => ({
  type: 'MOVE',
  direction,
  distanceCm,
  blockId: null,
});
const turn = (direction: 'LEFT' | 'RIGHT', degrees: number): DroneCommand => ({ type: 'TURN', direction, degrees, blockId: null });

function parse(xml: string): readonly DroneCommand[] {
  const r = parseRobolinkXml(xml);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(' '));
  return r.commands;
}

/** Ordered from least to most risky: run them top to bottom. */
const PROGRAMS: [string, () => readonly DroneCommand[]][] = [
  ['Take off → hover 2 s → land', () => [T, { type: 'HOVER', durationSeconds: 2, blockId: null }, L]],
  ['Forward 50 cm', () => [T, move('FORWARD', 50), L]],
  ['Backward 50 cm', () => [T, move('BACKWARD', 50), L]],
  ['Left 30 cm, right 30 cm', () => [T, move('LEFT', 30), move('RIGHT', 30), L]],
  ['Turn right 90°', () => [T, turn('RIGHT', 90), L]],
  ['Turn left 90°', () => [T, turn('LEFT', 90), L]],
  ['Turn right 90° → forward 40 cm', () => [T, turn('RIGHT', 90), move('FORWARD', 40), L]],
  // The mazes and free flight (the lessons have their own section).
  ...MAZES.filter((m) => m.exampleXml && !LESSONS.includes(m)).map((m): [string, () => readonly DroneCommand[]] => [
    m.name,
    () => parse(m.exampleXml!),
  ]),
];

/* ---------- Calibration results ---------- */

interface FlightRecord {
  readonly name: string;
  readonly at: string;
  readonly outcome: string;
  readonly calibration: Calibration;
  readonly measurements: Measurement[];
}

const RESULTS_KEY = 'birds.calibrationResults.v1';

function loadResults(): FlightRecord[] {
  try {
    return (JSON.parse(window.localStorage.getItem(RESULTS_KEY) ?? '[]') as FlightRecord[]) ?? [];
  } catch {
    return [];
  }
}

let results: FlightRecord[] = loadResults();

function saveResults() {
  try {
    window.localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Not remembered across reloads; the table still works.
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r0 = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : '–');
const r1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
/** Colour for a result: good ≤ `good`, fair ≤ `fair`, otherwise poor. */
const tone = (v: number, good: number, fair: number) => (!Number.isFinite(v) ? '' : v <= good ? 'good' : v <= fair ? 'fair' : 'poor');

/** Summary numbers for a set of flights. */
function summarise(flights: FlightRecord[]) {
  const all = flights.flatMap((f) => f.measurements);
  const moves = all.filter((m): m is Extract<Measurement, { kind: 'move' }> => m.kind === 'move');
  const turns = all.filter((m): m is Extract<Measurement, { kind: 'turn' }> => m.kind === 'turn');
  const ends = all.filter((m): m is Extract<Measurement, { kind: 'end' }> => m.kind === 'end');
  const movePct = moves.map((m) => (100 * m.movedCm) / m.askedCm);
  // Older saved results have no path samples.
  const side = moves.map((m) => m.maxSideCm).filter((v): v is number => typeof v === 'number');
  const turnErr = turns.map((t) => t.turnedDeg - t.askedDeg);
  return {
    flights: flights.length,
    completed: flights.filter((f) => f.outcome === 'completed').length,
    moves: moves.length,
    moveAvgPct: avg(movePct),
    moveWorstPct: movePct.length ? movePct.reduce((w, p) => (Math.abs(p - 100) > Math.abs(w - 100) ? p : w)) : NaN,
    sideAvg: avg(side),
    sideWorst: side.length ? Math.max(...side) : NaN,
    turns: turns.length,
    turnAvgErr: avg(turnErr),
    turnWorstErr: turnErr.length ? Math.max(...turnErr.map(Math.abs)) : NaN,
    courseAvgErr: avg(turns.map((t) => Math.abs(t.courseErrorDeg))),
    endAvg: avg(ends.map((e) => e.offCm)),
    endWorst: ends.length ? Math.max(...ends.map((e) => e.offCm)) : NaN,
  };
}

function renderResults() {
  const c = runner?.calibration ?? loadCalibration();
  ui.calibration.textContent = `Calibration now: turns aim ${c.overshootDeg.toFixed(1)}° short, distance ratio ${c.moveRatio.toFixed(2)}`;
  if (results.length === 0) {
    ui.results.innerHTML = '<p class="hint">No flights yet.</p>';
    return;
  }
  const names = [...new Set(results.map((r) => r.name))];
  const row = (label: string, flights: FlightRecord[]) => {
    const s = summarise(flights);
    const td = (text: string, cls = '') => `<td class="${cls}">${text}</td>`;
    return (
      `<tr>${td(label)}${td(`${s.completed}/${s.flights}`)}` +
      td(s.moves ? `${r0(s.moveAvgPct)}% (worst ${r0(s.moveWorstPct)}%)` : '–', tone(Math.abs(s.moveWorstPct - 100), 10, 20)) +
      td(Number.isFinite(s.sideAvg) ? `${r0(s.sideAvg)} cm (worst ${r0(s.sideWorst)} cm)` : '–', tone(s.sideWorst, 5, 10)) +
      td(s.turns ? `${s.turnAvgErr >= 0 ? '+' : ''}${r1(s.turnAvgErr)}° (worst ${r0(s.turnWorstErr)}°)` : '–', tone(s.turnWorstErr, 3, 6)) +
      td(s.turns ? `${r1(s.courseAvgErr)}°` : '–', tone(s.courseAvgErr, 2, 5)) +
      td(Number.isFinite(s.endAvg) ? `${r0(s.endAvg)} cm (worst ${r0(s.endWorst)} cm)` : '–', tone(s.endWorst, 10, 20)) +
      '</tr>'
    );
  };
  ui.results.innerHTML =
    '<table><thead><tr><th>Program</th><th>Completed</th><th>Moves: distance flown vs asked</th><th>Straightness: max off the line</th>' +
    '<th>Turns: error</th><th>Off course after turns</th><th>End point: off target</th></tr></thead><tbody>' +
    names.map((n) => row(n, results.filter((r) => r.name === n))).join('') +
    row('<b>All flights</b>', results) +
    '</tbody></table>';
}

/** A compact text summary to paste back for review. */
function resultsText(): string {
  const c = runner?.calibration ?? loadCalibration();
  const lines = [`Calibration now: overshoot ${c.overshootDeg.toFixed(1)}°, distance ratio ${c.moveRatio.toFixed(3)}`, ''];
  for (const name of [...new Set(results.map((r) => r.name))]) {
    const s = summarise(results.filter((r) => r.name === name));
    lines.push(
      `${name}: ${s.completed}/${s.flights} completed; moves ${r0(s.moveAvgPct)}% of asked (worst ${r0(s.moveWorstPct)}%); ` +
        `max off the line ${r0(s.sideAvg)} cm (worst ${r0(s.sideWorst)} cm); ` +
        `turn error ${r1(s.turnAvgErr)}° (worst ${r0(s.turnWorstErr)}°); off course ${r1(s.courseAvgErr)}°; ` +
        `end point ${r0(s.endAvg)} cm off (worst ${r0(s.endWorst)} cm)`,
    );
  }
  lines.push('', 'Per flight:');
  for (const f of results) {
    const parts = f.measurements.map((m) =>
      m.kind === 'move'
        ? `mv ${r0(m.movedCm)}/${m.askedCm}${m.offDeg !== null ? `@${r0(m.offDeg)}°` : ''}` +
          `${typeof m.maxSideCm === 'number' ? ` side ${r0(m.maxSideCm)}` : ''}${m.correctionDeg ? ` aim ${r0(m.correctionDeg)}°` : ''}`
        : m.kind === 'turn'
          ? `tn ${r0(m.turnedDeg)}/${m.askedDeg} crs ${r0(m.courseErrorDeg)}°`
          : `end ${r0(m.offCm)}cm (fwd ${r0(m.forwardCm)}, left ${r0(m.leftCm)})`,
    );
    lines.push(
      `${f.at} ${f.name} [${f.outcome}; cal ${f.calibration.overshootDeg.toFixed(1)}°/${f.calibration.moveRatio.toFixed(3)}]: ${parts.join('; ')}`,
    );
  }
  return lines.join('\n');
}

let link: SerialLink | null = null;
let runner: DroneRunner | null = null;
let ageTimer: number | undefined;

function log(msg: string) {
  const t = new Date().toISOString().slice(11, 23);
  ui.log.textContent += `${t}  ${msg}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

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
  ui.programs.querySelectorAll('button').forEach((b) => (b.disabled = !idle));
  ui.lessons.querySelectorAll('button').forEach((b) => (b.disabled = !idle));
  ui.resetCalibration.disabled = runner?.isRunning === true;
  ui.runXml.disabled = !idle;
  ui.abort.disabled = link === null;
  ui.stop.disabled = link === null;
}

async function fly(name: string, commands: () => readonly DroneCommand[]) {
  if (!runner) return;
  let program: readonly DroneCommand[];
  try {
    program = commands();
  } catch (e) {
    log(`✗ ${(e as Error).message}`);
    return;
  }
  runner.turnMethod = ui.headingTurns.checked ? 'drone-heading' : 'yaw-loop';
  log(`▶ ${name} (turns: ${runner.turnMethod}, learned overshoot ${runner.overshootDeg.toFixed(1)}°, distance ratio ${runner.moveRatio.toFixed(2)})`);
  const started = Date.now();
  const calibration = runner.calibration;
  const measurements: Measurement[] = [];
  const run = runner.run(program, {
    onStep: (i, c) => log(`  [${i + 1}/${program.length}] ${describeCommand(c)}`),
    onLog: (m) => log(`    ${m}`),
    onMeasure: (m) => measurements.push(m),
  });
  render();
  const outcome = await run;
  saveCalibration(runner.calibration);
  results.push({ name, at: new Date().toTimeString().slice(0, 8), outcome: outcome.status.toLowerCase(), calibration, measurements });
  saveResults();
  renderResults();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.status === 'FAILED')
    log(`✗ ${outcome.message}${outcome.commandIndex !== null ? ` (block ${outcome.commandIndex + 1})` : ''}`);
  else log(`${outcome.status === 'COMPLETED' ? '✓' : '■'} ${outcome.status.toLowerCase()} after ${secs} s`);
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
  link.onBytes((dir, bytes) => {
    const polling = bytes[2] === DataType.Request || bytes[2] === DataType.State || bytes[2] === DataType.Motion;
    if (ui.raw.checked && !polling) log(`${dir} ${toHex(bytes)}`);
  });
  runner = new DroneRunner(link, loadCalibration());
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

if (!isWebSerialSupported()) $('unsupported').hidden = false;

for (const lesson of LESSONS) {
  const b = document.createElement('button');
  b.textContent = lesson.name;
  b.title = lesson.description;
  b.onclick = () => void fly(lesson.name, () => parse(lesson.exampleXml!));
  ui.lessons.append(b);
}

ui.copyResults.onclick = async () => {
  const text = resultsText();
  try {
    await navigator.clipboard.writeText(text);
    log('✓ results copied to the clipboard');
  } catch {
    // Clipboard blocked: show the text to copy by hand.
    ui.resultsText.hidden = false;
    ui.resultsText.value = text;
    ui.resultsText.select();
  }
};
ui.clearResults.onclick = () => {
  if (!window.confirm('Clear all calibration results?')) return;
  results = [];
  saveResults();
  renderResults();
};
ui.resetCalibration.onclick = () => {
  if (!window.confirm('Forget what the drone has learned (turn overshoot and distance ratio)? Do this when switching to a different drone.')) return;
  clearCalibration();
  if (runner) {
    const fresh = loadCalibration();
    runner.overshootDeg = fresh.overshootDeg;
    runner.moveRatio = fresh.moveRatio;
  }
  log('calibration reset to defaults');
  renderResults();
};

for (const [name, program] of PROGRAMS) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => void fly(name, program);
  ui.programs.append(b);
}

ui.connect.onclick = () => void connect();
ui.disconnect.onclick = () => void disconnect();
ui.runXml.onclick = () => void fly('pasted program', () => parse(ui.xml.value));
ui.abort.onclick = () => {
  log('■ abort: landing');
  void runner?.abort();
};
ui.stop.onclick = () => {
  log('■ STOP: motors off');
  void runner?.emergencyStop();
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && link && e.target !== ui.xml) {
    e.preventDefault();
    ui.stop.click();
  }
});

// Leaving the page mid-flight: land rather than leave the drone flying.
const landIfFlying = () => {
  if (runner?.isRunning) void runner.abort();
};
window.addEventListener('pagehide', landIfFlying);
document.addEventListener('visibilitychange', () => document.hidden && landIfFlying());

render();
renderResults();
