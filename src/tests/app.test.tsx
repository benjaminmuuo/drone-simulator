import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import { DEFAULT_MAZE, findMaze } from '../mazes';
import { editor } from './editorMock';

vi.mock('../components/BlocklyEditor', () => import('./editorMock'));

const fixture = readFileSync(resolve(__dirname, 'fixtures/main.xml'), 'utf8');

function xmlFile(content: string, name = 'main.xml'): File {
  return new File([content], name, { type: 'text/xml' });
}

async function upload(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input missing');
  await userEvent.upload(input, file);
}

/** Lesson 2: forward 50 to the cone, turn right, forward 50 onto the pad. A box stack is straight ahead. */
const lesson2 = findMaze('lesson-2')!;

function chooseCourse(id: string) {
  fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: id } });
}

/** Opens Lesson 2 and imports `xml` (its own solution by default). */
async function lesson2With(xml = lesson2.exampleXml!) {
  render(<App />);
  chooseCourse('lesson-2');
  await upload(xmlFile(xml, 'lesson-2.xml'));
  await screen.findByText(/Program imported/);
}

/** main.xml, with its first 50 cm move made long enough to hit Lesson 2's box stack. */
const crashing = () => fixture.replace('<field name="NUM">50</field>', '<field name="NUM">200</field>');

async function importFixture() {
  render(<App />);
  await upload(xmlFile(fixture));
  await screen.findByText(/Program imported/);
}

/** Switch to fake animation frames once the (real-timer) file import is done. */
function useFakeFrames() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const programItems = () => within(screen.getByRole('list', { name: 'Interpreted program' })).getAllByRole('listitem');
const stateOf = (index: number) => programItems()[index]?.getAttribute('data-state');

beforeEach(() => editor.reset());
afterEach(() => {
  vi.useRealTimers();
});

/** Simulates the block editor reporting its program. */
async function editorReports(xml: string, reason: 'init' | 'load' | 'edit' = 'edit') {
  await waitFor(() => expect(editor.props).not.toBeNull());
  act(() => editor.props!.onChange(xml, reason));
}

describe('XML upload and program preview', () => {
  it('imports main.xml and lists the eight interpreted commands', async () => {
    await importFixture();
    expect(screen.getByText('main.xml')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Program imported — 8 commands');
    expect(programItems().map((li) => li.querySelector('.program__label')?.textContent)).toEqual([
      'Takeoff',
      'Hover — 2 seconds',
      'Forward — 50 cm',
      'Turn right — 90°',
      'Forward — 10 cm',
      'Turn right — 90°',
      'Forward — 50 cm',
      'Land',
    ]);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeEnabled();
    // The imported program opens in the block editor so it can be edited.
    await waitFor(() => expect(editor.loads).toEqual([fixture]));
  });

  it('disables Run until a program is imported', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeDisabled();
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Waiting for program');
  });

  it('shows clear errors for malformed XML', async () => {
    render(<App />);
    await upload(xmlFile('<xml><block type="takeoff">', 'broken.xml'));
    expect(await screen.findByText(/Could not import this program/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Import errors' })).toHaveTextContent(/not valid XML/);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeDisabled();
  });

  it('shows unsupported blocks with their block id', async () => {
    render(<App />);
    const xml = fixture.replace('type="hover"', 'type="controls_repeat_ext"');
    await upload(xmlFile(xml));
    const errors = await screen.findByRole('list', { name: 'Import errors' });
    expect(errors).toHaveTextContent('"controls_repeat_ext" block is not supported');
    expect(errors).toHaveTextContent('wP^sB$g8ZY#|plweMs_[');
  });

  it('replaces a failed import with a good one', async () => {
    render(<App />);
    await upload(xmlFile('nope', 'bad.xml'));
    await screen.findByText(/Could not import/);
    await upload(xmlFile(fixture));
    await screen.findByText(/Program imported/);
    expect(screen.queryByRole('list', { name: 'Import errors' })).not.toBeInTheDocument();
  });

  it('rejects non-XML files', async () => {
    render(<App />);
    // applyAccept: false mimics a user picking "All files" in the dialog.
    await userEvent.setup({ applyAccept: false }).upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['drone.takeoff()'], 'program.py'),
    );
    expect(await screen.findByText(/Please choose an .xml file/)).toBeInTheDocument();
  });

  it('shows sequence warnings at import time', async () => {
    render(<App />);
    const noLand = fixture.replace('<next><block type="land" id=":4V:#Sy{Qa-Zcf8bUFfv"></block></next>', '');
    await upload(xmlFile(noLand));
    expect(await screen.findByRole('list', { name: 'Program warnings' })).toHaveTextContent('Add a Land block');
  });
});

describe('block editor', () => {
  it('runs whatever the blocks say, checked by the same parser', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeDisabled();
    await editorReports(STARTER_PROGRAM_XML, 'init');
    expect(screen.getByRole('status')).toHaveTextContent('Ready to fly — 2 commands');
    expect(programItems().map((li) => li.querySelector('.program__label')?.textContent)).toEqual(['Takeoff', 'Land']);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeEnabled();
  });

  it('shows live problems with a link to the block', async () => {
    render(<App />);
    const twoStacks = STARTER_PROGRAM_XML.replace('</xml>', '<block type="land" id="stray" x="300" y="40"></block></xml>');
    await editorReports(twoStacks);
    expect(screen.getByRole('status')).toHaveTextContent('1 problem to fix before flying');
    expect(screen.getByRole('list', { name: 'Program problems' })).toHaveTextContent('2 separate groups of blocks');
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeDisabled();

    const badNumber = fixture.replace('<field name="NUM">2</field>', '<field name="NUM">999</field>');
    await editorReports(badNumber);
    fireEvent.click(within(screen.getByRole('list', { name: 'Program problems' })).getByRole('button', { name: 'Show block' }));
    expect(editor.focused).toEqual(['wP^sB$g8ZY#|plweMs_[']);
  });

  it('New and Example load programs into the editor; Example is the current course\'s solution', async () => {
    render(<App />);
    await editorReports(STARTER_PROGRAM_XML, 'init');
    fireEvent.click(screen.getByRole('button', { name: /Example/ }));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    chooseCourse('maze-2');
    fireEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(editor.loads).toEqual([DEFAULT_MAZE.exampleXml, STARTER_PROGRAM_XML, findMaze('maze-2')!.exampleXml]);
  });

  it('an imported file stays "imported" until the student edits it', async () => {
    await importFixture();
    await editorReports(fixture, 'load');
    expect(screen.getByRole('status')).toHaveTextContent('Program imported — 8 commands');
    await editorReports(fixture.replace('<field name="NUM">2</field>', '<field name="NUM">3</field>'));
    expect(screen.getByRole('status')).toHaveTextContent('Ready to fly — 8 commands');
    expect(screen.getByText('main.xml')).toBeInTheDocument();
  });

  it('downloads the program as Robolink XML', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:program');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await editorReports(STARTER_PROGRAM_XML, 'init');
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(await createObjectURL.mock.calls[0]![0].text()).toBe(STARTER_PROGRAM_XML);
    click.mockRestore();
  });

  it('highlights the flying block and marks the failing one', async () => {
    await lesson2With(crashing());
    useFakeFrames();
    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(200);
    expect(editor.props!.activeBlockId).toBe('I70WrNhz.^S(`yUbFg({');
    advance(20_000);
    expect(editor.props!.activeBlockId).toBeNull();
    expect(editor.props!.failedBlockId).toBe('u^Q[2l2K1VSTa1xKFqj[');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Show block' }));
    expect(editor.focused.at(-1)).toBe('u^Q[2l2K1VSTa1xKFqj[');
  });
});

describe('playback', () => {
  it('runs the sample to completion with highlighting and success feedback', async () => {
    await lesson2With();
    useFakeFrames();

    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(200);
    expect(stateOf(0)).toBe('active');
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Running');
    expect(screen.getByTestId('telemetry-command')).toHaveTextContent('1. Takeoff');

    // Takeoff (1.2 s) + 2 s hover = 3.2 simulated s, which is 6.4 s at the default 0.5× → into the first move.
    advance(7_000);
    expect(stateOf(0)).toBe('done');
    expect(stateOf(1)).toBe('done');
    expect(stateOf(2)).toBe('active');

    advance(20_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Mission complete!');
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Mission complete');
    expect(screen.getByTestId('telemetry-x')).toHaveTextContent('200.0 cm');
    expect(screen.getByTestId('telemetry-y')).toHaveTextContent('200.0 cm');
    expect(screen.getByTestId('telemetry-heading')).toHaveTextContent('90°');
    expect(screen.getByTestId('telemetry-flight')).toHaveTextContent('Landed');
    expect(programItems().every((li) => li.getAttribute('data-state') === 'done')).toBe(true);
  });

  it('pauses, resumes and resets', async () => {
    await lesson2With();
    useFakeFrames();

    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(7_000); // mid-way through the first move
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Paused');
    const pausedY = screen.getByTestId('telemetry-y').textContent;

    advance(2_000);
    expect(screen.getByTestId('telemetry-y').textContent).toBe(pausedY);

    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    advance(500);
    expect(screen.getByTestId('telemetry-y').textContent).not.toBe(pausedY);

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(screen.getByTestId('telemetry-status')).toHaveTextContent('Ready');
    expect(screen.getByTestId('telemetry-x')).toHaveTextContent('150.0 cm');
    expect(screen.getByTestId('telemetry-y')).toHaveTextContent('250.0 cm');
    expect(screen.getByTestId('telemetry-flight')).toHaveTextContent('Landed');
    expect(programItems().every((li) => li.getAttribute('data-state') === 'pending')).toBe(true);
    expect(screen.getByRole('button', { name: /Run simulation/ })).toBeEnabled();
  });

  it('starts at 0.5× (close to a real drone) and plays faster at a higher speed', async () => {
    await lesson2With();
    expect(screen.getByRole('radio', { name: '0.5×' })).toHaveAttribute('aria-checked', 'true');
    useFakeFrames();
    fireEvent.click(screen.getByRole('radio', { name: '4×' }));
    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(3_000); // ≈ 12 simulated seconds at 4×
    expect(screen.getByRole('alert')).toHaveTextContent('Mission complete!');
  });

  it('reports a collision with the failing command highlighted', async () => {
    await lesson2With(crashing());
    useFakeFrames();

    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(20_000);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Crash! The drone hit an obstacle');
    expect(alert).toHaveTextContent('Step 3 (Forward — 200 cm)');
    expect(within(alert).getByRole('button', { name: 'Show block' })).toHaveAttribute('title', 'Block ID u^Q[2l2K1VSTa1xKFqj[');
    expect(screen.getByTestId('telemetry-flight')).toHaveTextContent('Crashed');
    expect(stateOf(2)).toBe('failed');
    expect(stateOf(3)).toBe('pending');
  });
});

describe('without WebGL', () => {
  // jsdom has no WebGL, like an old or locked-down classroom browser.
  it('explains that 3D is unavailable but still runs programs', async () => {
    render(<App />);
    expect(screen.getByRole('note')).toHaveTextContent('does not support 3D graphics (WebGL)');
    expect(screen.queryByRole('radiogroup', { name: 'Camera' })).not.toBeInTheDocument();

    chooseCourse('lesson-2');
    await upload(xmlFile(lesson2.exampleXml!, 'lesson-2.xml'));
    await screen.findByText(/Program imported/);
    useFakeFrames();
    fireEvent.click(screen.getByRole('button', { name: /Run simulation/ }));
    advance(20_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Mission complete!');
  });

  it('groups the courses: Flight School, then the mazes, then free flight', () => {
    render(<App />);
    const groups = screen.getByRole('combobox', { name: /Course/ }).querySelectorAll('optgroup');
    expect([...groups].map((g) => [g.label, g.querySelectorAll('option').length])).toEqual([
      ['Flight School', 5],
      ['Maze challenges', 2],
      ['Free flight', 1],
    ]);
    expect(screen.getByRole('heading', { name: 'Lesson 1: First flight' })).toBeInTheDocument();
  });

  it('can switch mazes', async () => {
    render(<App />);
    fireEvent.change(screen.getByRole('combobox', { name: /Course/ }), { target: { value: 'open-field' } });
    await waitFor(() => expect(screen.getByTestId('telemetry-x')).toHaveTextContent('200.0 cm'));
  });
});
