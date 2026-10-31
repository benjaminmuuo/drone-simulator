import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { STARTER_PROGRAM_XML } from '../blocks/robolinkBlocks';
import type { EditorChangeReason } from '../components/BlocklyEditor';
import type { ViewportController } from '../components/Maze3DViewport';
import { FlightHud } from '../components/FlightHud';
import { FlightPlan } from '../components/FlightPlan';
import { Icon, LogoMark } from '../components/Icon';
import { MissionFeedback } from '../components/MissionFeedback';
import { ProgramPanel } from '../components/ProgramPanel';
import type { ImportFailure } from '../components/ProgramPanel';
import { RealDronePanel } from '../components/RealDronePanel';
import { TransportBar } from '../components/TransportBar';
import { useRealDrone } from '../hardware/useRealDrone';
import { useSimulation } from '../hooks/useSimulation';
import type { PlaybackPhase } from '../hooks/useSimulation';
import { COURSE_GROUPS, DEFAULT_MAZE, findMaze } from '../mazes';
import { DEFAULT_FLIGHT_HEIGHT_CM, FLIGHT_HEIGHT_OPTIONS_CM, OBSTACLE_CLEARANCE_CM } from '../mazes/constants';
import type { Point } from '../mazes/types';
import { describeCommand } from '../parser/describeCommand';
import { PARSER_LIMITS, parseRobolinkXml } from '../parser/RobolinkXmlParser';
import type { ParseIssue } from '../parser/types';
import type { CameraMode, CameraNudge, FollowView, MeasureState } from '../three/createDroneWorld';
import { formatPoint } from '../three/measure';
import type { SnappedPoint } from '../three/measure';
import { supportsWebGL } from '../three/supportsWebGL';
import { DEFAULT_THEME, THEMES } from '../three/themeOptions';
import type { ThemeId } from '../three/themeOptions';

// Heavy parts are only downloaded when shown.
const Maze3DViewport = lazy(() => import('../components/Maze3DViewport'));
const BlocklyEditor = lazy(() => import('../components/BlocklyEditor'));

const CAMERA_MODES: ReadonlyArray<{ id: CameraMode; label: string }> = [
  { id: 'orbit', label: 'Overview' },
  { id: 'follow', label: 'Follow drone' },
  { id: 'top', label: 'Top-down' },
];

const FOLLOW_VIEWS: ReadonlyArray<{ id: FollowView; label: string }> = [
  { id: 'behind', label: 'Behind' },
  { id: 'right', label: 'Right side' },
  { id: 'left', label: 'Left side' },
  { id: 'front', label: 'Front' },
];

const NO_MEASUREMENT: MeasureState = { first: null, result: null };

/** After Run, the camera glides to the drone; the flight starts once it has arrived. */
export const LAUNCH_DELAY_MS = 1100;

const CAMERA_KEYS: Record<string, CameraNudge> = {
  ArrowLeft: 'rotate-left',
  ArrowRight: 'rotate-right',
  ArrowUp: 'tilt-up',
  ArrowDown: 'tilt-down',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '0': 'recenter',
};
const NO_CHECKPOINTS: ReadonlySet<string> = new Set();
const NO_TRAIL: readonly Point[] = [];

const describePoint = (p: SnappedPoint) => (p.label ? `${p.label} (${formatPoint(p.point)})` : formatPoint(p.point));

function measureText(measureMode: boolean, state: MeasureState): string | null {
  if (state.result) {
    const { a, b, distanceCm, acrossCm, alongCm, upCm } = state.result;
    return (
      `${distanceCm} cm from ${describePoint(a)} to ${describePoint(b)}: ` +
      `${acrossCm} cm across (x), ${alongCm} cm along (y)${upCm > 0 ? `, ${upCm} cm up` : ''}.`
    );
  }
  if (state.first) return `From ${describePoint(state.first)}. Now click the second point.`;
  if (measureMode) return 'Click the first point. The white dots are corners, pads and cones you can snap to.';
  return null;
}

interface Program {
  readonly xml: string;
  /** Came straight from an imported file (not yet edited). */
  readonly imported: boolean;
  readonly fileName: string | null;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

const fileIssue = (message: string): ParseIssue => ({ code: 'MALFORMED_XML', message, blockId: null, blockType: null });

function downloadXml(xml: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const STATUS_LABELS: Record<PlaybackPhase, string> = {
  idle: 'Ready',
  running: 'Running',
  paused: 'Paused',
  finished: 'Finished',
};

/** If the block editor cannot load (very old browser), the app still works with imported files. */
class EditorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? (
      <div className="editor-fallback">
        <Icon name="alert" size={22} />
        <p>The block editor could not start in this browser. You can still import a program from Robolink Blockly.</p>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T | null;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="segmented__option" onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [program, setProgram] = useState<Program | null>(null);
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(null);
  const [loadRequest, setLoadRequest] = useState<{ xml: string; nonce: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ blockId: string; nonce: number } | null>(null);
  const [editorFailed, setEditorFailed] = useState(false);

  const [mazeId, setMazeId] = useState(DEFAULT_MAZE.id);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [flightHeightCm, setFlightHeightCm] = useState<number>(DEFAULT_FLIGHT_HEIGHT_CM);
  const [showGrid, setShowGrid] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measureState, setMeasureState] = useState<MeasureState>(NO_MEASUREMENT);
  const [webglAvailable] = useState(supportsWebGL);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [followView, setFollowView] = useState<FollowView>('behind');
  const [view3dError, setView3dError] = useState<string | null>(null);
  const handle3dError = useCallback((message: string) => setView3dError(message), []);
  const viewport = useRef<ViewportController | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchTimer = useRef(0);
  const cameraBeforeMeasure = useRef<CameraMode>('orbit');
  const show3d = webglAvailable && view3dError === null;
  const maze = findMaze(mazeId) ?? DEFAULT_MAZE;

  const parsed = useMemo(() => (program ? parseRobolinkXml(program.xml) : null), [program]);
  const commands = parsed?.ok ? parsed.commands : null;
  const sim = useSimulation(commands, maze, flightHeightCm);
  const drone = useRealDrone();
  const measureMessage = measureText(measureMode, measureState);

  const loadIntoEditor = useCallback((xml: string) => setLoadRequest((r) => ({ xml, nonce: (r?.nonce ?? 0) + 1 })), []);
  const showBlock = useCallback((blockId: string) => setFocusRequest((r) => ({ blockId, nonce: (r?.nonce ?? 0) + 1 })), []);

  const handleEditorChange = useCallback((xml: string, reason: EditorChangeReason) => {
    setProgram((current) => {
      // A file just loaded into the editor stays "imported" until the student edits it.
      if (reason === 'load' && current?.imported) return { ...current, xml };
      if (current?.xml === xml) return current;
      return { xml, imported: false, fileName: current?.fileName ?? null };
    });
    if (reason === 'edit') setImportFailure(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const fail = (issues: readonly ParseIssue[]) => setImportFailure({ fileName: file.name, issues });
      if (!file.name.toLowerCase().endsWith('.xml')) {
        fail([fileIssue('Please choose an .xml file downloaded from Robolink Blockly.')]);
        return;
      }
      if (file.size > PARSER_LIMITS.maxFileBytes) {
        fail([fileIssue(`This file is too large (limit ${PARSER_LIMITS.maxFileBytes / 1024} KB). Is it really a Blockly program?`)]);
        return;
      }
      let text: string;
      try {
        text = await readFileText(file);
      } catch {
        fail([fileIssue('The file could not be read. Try downloading it again.')]);
        return;
      }
      const result = parseRobolinkXml(text);
      if (!result.ok) {
        fail(result.errors);
        return;
      }
      setImportFailure(null);
      setProgram({ xml: text, imported: true, fileName: file.name });
      loadIntoEditor(text);
    },
    [loadIntoEditor],
  );

  const startFresh = (xml: string) => {
    setProgram((current) => current && { ...current, imported: false, fileName: null });
    setImportFailure(null);
    loadIntoEditor(xml);
  };
  const resetMeasure = () => setMeasureState(NO_MEASUREMENT);

  // Measuring works best on a floor plan, so it switches to top-down and back.
  const toggleMeasure = () => {
    if (measureMode) {
      setMeasureMode(false);
      setCameraMode(cameraBeforeMeasure.current);
    } else {
      cameraBeforeMeasure.current = cameraMode === 'top' ? 'orbit' : cameraMode;
      setMeasureMode(true);
      setCameraMode('top');
    }
    resetMeasure();
  };

  const cancelLaunch = useCallback(() => {
    window.clearTimeout(launchTimer.current);
    setLaunching(false);
  }, []);
  useEffect(() => () => window.clearTimeout(launchTimer.current), []);
  // A different program or course cancels a pending take-off.
  useEffect(cancelLaunch, [sim.timeline, cancelLaunch]);

  /** Run: put the drone back on its start mark, bring the camera to it, then fly. */
  const startFlight = () => {
    if (!show3d) {
      sim.run();
      return;
    }
    sim.reset();
    setMeasureMode(false);
    resetMeasure();
    setCameraMode('follow');
    setLaunching(true);
    window.clearTimeout(launchTimer.current);
    launchTimer.current = window.setTimeout(() => {
      setLaunching(false);
      sim.run();
    }, LAUNCH_DELAY_MS);
  };

  const onStageKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = CAMERA_KEYS[event.key];
    if (!action || event.target !== event.currentTarget) return;
    event.preventDefault();
    viewport.current?.nudgeCamera(action);
  };

  const { phase, frame, result } = sim;
  const steps = commands ?? [];
  const playing = phase !== 'idle';
  const activeIndex = playing ? frame.activeStepIndex : null;
  const activeCommand = activeIndex !== null ? steps[activeIndex] : undefined;
  const failure = result?.failure ?? null;
  const failedIndex = failure?.commandIndex ?? null;
  const failureShown = phase === 'finished' && failure !== null;
  const editorReady = !editorFailed && program !== null;
  const onShowBlock = editorReady ? showBlock : null;

  // A real flight takes over the block highlight and the flight plan.
  const realFlight = drone.flight.phase === 'flying' ? drone.flight : null;
  const realActive = realFlight?.activeIndex ?? null;
  const realActiveCommand = realFlight && realActive !== null ? realFlight.commands[realActive] : undefined;
  // Rehearse first: only a program that passes the simulation may fly for real.
  const flyBlockers = !commands
    ? ['Fix the problems in your program first.']
    : result?.status !== 'SUCCESS'
      ? ['This program fails in the simulator. Fix it until the simulation says “Mission complete”.']
      : [];

  const crashed = failureShown && failure.contactPoint !== undefined;
  const flightLabel = crashed
    ? 'Crashed'
    : frame.pose.altitude <= 0
      ? 'Landed'
      : frame.pose.altitude >= 1
        ? 'Flying'
        : activeCommand?.type === 'LAND'
          ? 'Landing…'
          : 'Taking off…';

  let statusLabel = STATUS_LABELS[phase];
  let statusTone: 'idle' | 'live' | 'ok' | 'error' = phase === 'running' || phase === 'paused' ? 'live' : 'idle';
  if (phase === 'finished' && result) {
    statusLabel = result.status === 'SUCCESS' ? 'Mission complete' : 'Mission failed';
    statusTone = result.status === 'SUCCESS' ? 'ok' : 'error';
  }
  if (launching) {
    statusLabel = 'Getting ready';
    statusTone = 'live';
  }
  if (!commands) {
    statusLabel = 'Waiting for program';
    statusTone = 'idle';
  }

  const editor = (
    <EditorBoundary onError={() => setEditorFailed(true)}>
      <Suspense fallback={<div className="editor-loading">Loading blocks…</div>}>
        <BlocklyEditor
          loadRequest={loadRequest}
          focusRequest={focusRequest}
          activeBlockId={
            realFlight
              ? (realActiveCommand?.blockId ?? null)
              : phase === 'running' || phase === 'paused'
                ? (activeCommand?.blockId ?? null)
                : null
          }
          failedBlockId={failureShown ? failure.blockId : null}
          failedMessage={failureShown ? failure.message : null}
          onChange={handleEditorChange}
        />
      </Suspense>
    </EditorBoundary>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div className="brand__text">
            <h1 className="brand__name">BIRDS Flight Lab</h1>
            <span className="brand__tag">CoDrone EDU simulator</span>
          </div>
        </div>
        <p className="topbar__note">
          <Icon name="info" />
          <span>
            Shows the <strong>expected</strong> flight. Real drones can drift with battery, sensors and air, so always fly
            carefully. When the simulation passes, you can fly the real drone over USB.
          </span>
        </p>
      </header>

      <main className="layout">
        <div className="layout__program">
          <ProgramPanel
            editor={editor}
            fileName={program?.fileName ?? null}
            imported={program?.imported ?? false}
            loading={program === null && !editorFailed}
            commandCount={steps.length}
            errors={parsed && !parsed.ok ? parsed.errors : []}
            warnings={parsed?.ok ? parsed.warnings : []}
            importFailure={importFailure}
            canDownload={program !== null}
            onFile={handleFile}
            onDownload={() => program && downloadXml(program.xml, program.fileName ?? 'drone-program.xml')}
            onNew={() => startFresh(STARTER_PROGRAM_XML)}
            onExample={() => startFresh(maze.exampleXml ?? STARTER_PROGRAM_XML)}
            onShowBlock={onShowBlock}
          />
        </div>

        <div className="layout__flight">
          <section className="card flight-card" aria-labelledby="maze-title">
            <header className="card__header course">
              <div className="card__titles">
                <h2 id="maze-title" className="card__title">
                  {maze.name}
                </h2>
                <p className="card__subtitle">{maze.description}</p>
              </div>
            </header>
            <div className="course__controls">
              <label className="field">
                <span className="field__label">Course</span>
                <select
                  className="select"
                  value={mazeId}
                  onChange={(e) => {
                    setMazeId(e.target.value);
                    resetMeasure();
                  }}
                  disabled={phase === 'running'}
                >
                  {COURSE_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.courses.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="field__label">Scene</span>
                <Segmented
                  label="Scene"
                  options={THEMES}
                  value={theme}
                  onChange={(t) => {
                    setTheme(t);
                    resetMeasure();
                  }}
                />
              </div>
              <label className="field">
                <span className="field__label">Flight height</span>
                <select
                  className="select"
                  value={flightHeightCm}
                  onChange={(e) => setFlightHeightCm(Number(e.target.value))}
                  disabled={phase === 'running'}
                >
                  {FLIGHT_HEIGHT_OPTIONS_CM.map((h) => (
                    <option key={h} value={h}>
                      {h} cm
                    </option>
                  ))}
                </select>
              </label>
              <label className="switch">
                <input type="checkbox" role="switch" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                <span className="switch__track" aria-hidden="true" />
                <span className="field__label">Grid</span>
              </label>
              <p className="course__hint">
                Set flight height to how high your drone hovers after takeoff. It flies over boxes lower than{' '}
                <strong>{flightHeightCm - OBSTACLE_CLEARANCE_CM} cm</strong> and crashes into taller ones.
              </p>
            </div>

            <div
              className="stage"
              tabIndex={show3d ? 0 : undefined}
              onKeyDown={show3d ? onStageKey : undefined}
              aria-label={show3d ? '3D view. Arrow keys rotate and tilt the camera, plus and minus zoom, 0 re-centres.' : undefined}
            >
              {show3d ? (
                <Suspense fallback={<div className="maze3d maze3d--loading">Loading 3D world…</div>}>
                  <Maze3DViewport
                    maze={maze}
                    theme={theme}
                    flightHeightCm={flightHeightCm}
                    timeline={sim.timeline}
                    elapsed={sim.elapsed}
                    phase={phase}
                    failure={failure}
                    visitedCheckpoints={playing ? sim.visitedCheckpoints : NO_CHECKPOINTS}
                    trail={playing ? sim.trail : NO_TRAIL}
                    showGrid={showGrid}
                    cameraMode={cameraMode}
                    followView={followView}
                    measureMode={measureMode}
                    onMeasure={setMeasureState}
                    onError={handle3dError}
                    controllerRef={viewport}
                  />
                </Suspense>
              ) : (
                <div className="maze3d maze3d--unavailable" role="note">
                  <Icon name="alert" size={26} />
                  <p className="maze3d__title">The 3D view could not start on this computer.</p>
                  <p>
                    {webglAvailable
                      ? 'The graphics card stopped the 3D view. Try reloading the page or closing other tabs.'
                      : 'This browser does not support 3D graphics (WebGL). Try an up-to-date Chrome, Edge or Firefox, and check that hardware acceleration is turned on.'}
                  </p>
                  <p>You can still run your program: the steps, telemetry and mission result all work.</p>
                </div>
              )}

              {show3d && (
                <div className="hud hud--top">
                  <div className="hud__group">
                    <div className="glass glass--pad">
                      <Segmented
                        label="Camera"
                        options={CAMERA_MODES}
                        value={cameraMode}
                        onChange={(mode) => {
                          if (measureMode) {
                            setMeasureMode(false);
                            resetMeasure();
                          }
                          setCameraMode(mode);
                        }}
                        size="sm"
                      />
                    </div>
                    {cameraMode === 'follow' && (
                      <div className="glass glass--pad">
                        <Segmented label="View the drone from" options={FOLLOW_VIEWS} value={followView} onChange={setFollowView} size="sm" />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-pressed={measureMode}
                    className={`btn btn--glass btn--sm${measureMode ? ' btn--glass-on' : ''}`}
                    onClick={toggleMeasure}
                  >
                    <Icon name="ruler" /> Measure
                  </button>
                </div>
              )}
              <div className="hud hud--bottom">
                <FlightHud pose={frame.pose} flightLabel={flightLabel} />
                {show3d && (
                  <div className="camera-pad glass" role="group" aria-label="Camera controls">
                    {cameraMode !== 'top' && (
                      <>
                        <button type="button" className="camera-pad__btn" aria-label="Rotate camera left" title="Rotate left (←)" onClick={() => viewport.current?.nudgeCamera('rotate-left')}>
                          <Icon name="rotate-left" />
                        </button>
                        <button type="button" className="camera-pad__btn" aria-label="Rotate camera right" title="Rotate right (→)" onClick={() => viewport.current?.nudgeCamera('rotate-right')}>
                          <Icon name="rotate" />
                        </button>
                        <button type="button" className="camera-pad__btn" aria-label="Tilt camera up" title="Tilt up (↑)" onClick={() => viewport.current?.nudgeCamera('tilt-up')}>
                          <Icon name="chevron-up" />
                        </button>
                        <button type="button" className="camera-pad__btn" aria-label="Tilt camera down" title="Tilt down (↓)" onClick={() => viewport.current?.nudgeCamera('tilt-down')}>
                          <Icon name="chevron-down" />
                        </button>
                        <span className="camera-pad__sep" aria-hidden="true" />
                      </>
                    )}
                    <button type="button" className="camera-pad__btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => viewport.current?.nudgeCamera('zoom-in')}>
                      <Icon name="plus" />
                    </button>
                    <button type="button" className="camera-pad__btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => viewport.current?.nudgeCamera('zoom-out')}>
                      <Icon name="minus" />
                    </button>
                    <button type="button" className="camera-pad__btn" aria-label="Re-centre camera" title="Re-centre (0)" onClick={() => viewport.current?.nudgeCamera('recenter')}>
                      <Icon name="crosshair" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {show3d && measureMessage && (
              <div className="measure-bar">
                <Icon name="ruler" />
                <div className="measure-bar__body">
                  <p className="measure-bar__text" aria-live="polite">
                    {measureMessage}
                  </p>
                  <span className="measure-bar__keys">Drag to pan · scroll to zoom · Esc clears</span>
                </div>
                {(measureState.first || measureState.result) && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => viewport.current?.clearMeasurement()}>
                    Clear
                  </button>
                )}
              </div>
            )}

            <TransportBar
              phase={phase}
              canRun={commands !== null && !launching && !realFlight}
              launching={launching}
              speed={sim.speed}
              elapsed={sim.elapsed}
              total={sim.timeline.totalSeconds}
              statusLabel={statusLabel}
              statusTone={statusTone}
              currentCommand={activeCommand ? `${(activeIndex ?? 0) + 1}. ${describeCommand(activeCommand)}` : '—'}
              onRun={startFlight}
              onPause={sim.pause}
              onResume={sim.resume}
              onReset={() => {
                cancelLaunch();
                sim.reset();
              }}
              onSpeedChange={sim.setSpeed}
            />

            {phase === 'finished' && result && <MissionFeedback result={result} onShowBlock={onShowBlock} />}

            <RealDronePanel drone={drone} commands={commands} blockers={flyBlockers} onShowBlock={onShowBlock} />
          </section>
          {realFlight ? (
            <FlightPlan commands={realFlight.commands} activeIndex={realActive} completedCount={realActive ?? 0} failedIndex={null} />
          ) : (
            <FlightPlan
              commands={steps}
              activeIndex={activeIndex}
              completedCount={playing ? frame.completedSteps : 0}
              failedIndex={failedIndex}
            />
          )}
        </div>
      </main>

      <footer className="footer">
        Sizes are in centimetres and match the real course: measure from the taped 0,0 corner. Box stacks and walls are
        obstacles, red = no-fly zone, H pad = landing zone, orange ring and cone = checkpoint.
      </footer>
    </div>
  );
}
