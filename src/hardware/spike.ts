/**
 * Hardware test page (spike/hardware.html). Not part of the app build.
 * Flies small test programs through DroneRunner so moves, turns and the
 * safety paths can be checked on a real drone before the app UI uses them.
 */
import { describeCommand } from '../parser/describeCommand';
import { parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { DroneCommand } from '../parser/types';
import { DroneRunner } from './DroneRunner';
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
  // The app's Example U-turn, but 40 cm across instead of 10 cm so the sideways step is easy to see.
  // (The app keeps 10 cm: 40 cm would miss the Beginner Course landing pad.)
  [
    'U-turn: forward 50, right, 40 cm across, right, forward 50',
    () => [
      T,
      { type: 'HOVER', durationSeconds: 2, blockId: null },
      move('FORWARD', 50),
      turn('RIGHT', 90),
      move('FORWARD', 40),
      turn('RIGHT', 90),
      move('FORWARD', 50),
      L,
    ],
  ],
];

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
  const run = runner.run(program, {
    onStep: (i, c) => log(`  [${i + 1}/${program.length}] ${describeCommand(c)}`),
    onLog: (m) => log(`    ${m}`),
  });
  render();
  const outcome = await run;
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
  runner = new DroneRunner(link);
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
