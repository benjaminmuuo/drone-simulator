/**
 * Builds and runs the 3D scene. It only *reads* simulation snapshots; the
 * drone's path always comes from the authoritative timeline, and the extra
 * realism (tilt, hover bob, propeller spin, crash fall) is purely visual.
 *
 * Camera: the student's drags move an invisible "proxy" camera; the real
 * camera chases the proxy with critically damped springs, which is what makes
 * game cameras feel smooth (no jumps between modes, gentle lag behind the
 * drone, softly easing round turns).
 */
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  MathUtils,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Spherical,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Texture } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { frameAt } from '../animation/timeline';
import type { Timeline } from '../animation/timeline';
import { headingVector } from '../engine/MovementEngine';
import type { SimulationFailure } from '../engine/types';
import { DEFAULT_FLIGHT_HEIGHT_CM } from '../mazes/constants';
import type { MazeDefinition, Point } from '../mazes/types';
import { clampToBounds, clearViewScale, smoothDamp } from './cameraView';
import { arenaToWorld, headingToYaw } from './coords';
import { createDroneModel } from './droneModel';
import { createMazeObjects } from './mazeObjects';
import { SNAP_RADIUS_PX, chooseSnap, formatPoint, freePoint, keyPoints, measureBetween } from './measure';
import type { Measurement, SnapCandidate, SnappedPoint } from './measure';
import { attitudeAt, crashFall, hoverWobble } from './motion';
import { createScenery } from './scenery';
import type { ThemeId } from './themeOptions';

export type CameraMode = 'orbit' | 'follow' | 'top';
/** Where the follow camera sits, relative to the way the drone is facing. */
export type FollowView = 'behind' | 'right' | 'left' | 'front';

export interface WorldSnapshot {
  readonly timeline: Timeline;
  readonly elapsed: number;
  readonly phase: 'idle' | 'running' | 'paused' | 'finished';
  readonly failure: SimulationFailure | null;
  readonly visitedCheckpoints: ReadonlySet<string>;
  readonly trail: readonly Point[];
}

/** Progress of the measuring tool: the first point, then the result. */
export interface MeasureState {
  readonly first: SnappedPoint | null;
  readonly result: Measurement | null;
}

export type CameraNudge = 'rotate-left' | 'rotate-right' | 'tilt-up' | 'tilt-down' | 'zoom-in' | 'zoom-out' | 'recenter';

/** One press of a camera button. */
const NUDGE_ROTATE = MathUtils.degToRad(35);
const NUDGE_TILT = MathUtils.degToRad(10);
const NUDGE_ZOOM = Math.log(1.3);

export interface DroneWorldOptions {
  readonly theme: ThemeId;
  readonly onMeasure?: (state: MeasureState) => void;
}

export interface DroneWorld {
  setSnapshot(snapshot: WorldSnapshot): void;
  setCameraMode(mode: CameraMode): void;
  /** Swing the follow camera to a side of the drone. Dragging still rotates freely. */
  setFollowView(view: FollowView): void;
  setShowGrid(show: boolean): void;
  setFlightHeight(heightCm: number): void;
  /** While on, clicks in the scene place measuring points instead of nothing. */
  setMeasureMode(on: boolean): void;
  clearMeasurement(): void;
  /** Smoothly rotate, tilt or zoom the camera by one step, or re-centre it. */
  nudgeCamera(action: CameraNudge): void;
  dispose(): void;
}

/** Exponential smoothing factor that is independent of frame rate. */
const smoothing = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Follow-camera position around the drone: azimuth 0 = behind, 90 = right side. */
interface Orbit {
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
}

const FOLLOW_VIEWS: Record<FollowView, Orbit> = {
  behind: { azimuthDeg: 0, elevationDeg: 22, distance: 120 },
  right: { azimuthDeg: 90, elevationDeg: 10, distance: 120 },
  left: { azimuthDeg: -90, elevationDeg: 10, distance: 120 },
  front: { azimuthDeg: 180, elevationDeg: 14, distance: 120 },
};

/** Spring times (seconds) for the camera position and look-at point in each mode. */
const CAMERA_SMOOTHING: Record<CameraMode, { position: number; target: number }> = {
  orbit: { position: 0.12, target: 0.12 },
  follow: { position: 0.2, target: 0.09 },
  top: { position: 0.3, target: 0.3 },
};
/** Extra spring time right after a mode change, so the camera glides across. */
const MODE_CHANGE_SMOOTHING = 0.45;
/** How long the follow camera takes to swing round after the drone turns. */
const FOLLOW_TURN_LAG_SECONDS = 0.8;
/** How far ahead along the drone's motion the follow camera looks (seconds). */
const LOOK_AHEAD_SECONDS = 0.25;

/** Signed shortest difference between two angles, in degrees (-180, 180]. */
const angleDelta = (from: number, to: number) => {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

class SpringVector {
  readonly value = new Vector3();
  private readonly vx = { v: 0 };
  private readonly vy = { v: 0 };
  private readonly vz = { v: 0 };
  step(target: Vector3, smoothTime: number, dt: number): Vector3 {
    this.value.set(
      smoothDamp(this.value.x, target.x, this.vx, smoothTime, dt),
      smoothDamp(this.value.y, target.y, this.vy, smoothTime, dt),
      smoothDamp(this.value.z, target.z, this.vz, smoothTime, dt),
    );
    return this.value;
  }
  jump(to: Vector3) {
    this.value.copy(to);
    this.vx.v = this.vy.v = this.vz.v = 0;
  }
}

export function createDroneWorld(container: HTMLElement, maze: MazeDefinition, options: DroneWorldOptions): DroneWorld {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const span = Math.max(maze.widthCm, maze.heightCm);
  const scenery = createScenery(options.theme, scene, renderer, maze);
  renderer.toneMappingExposure = scenery.exposure;
  const objects = createMazeObjects(maze, options.theme);
  scene.add(objects.root);
  const drone = createDroneModel();
  drone.root.rotation.order = 'YXZ';
  scene.add(drone.root);

  const camera = new PerspectiveCamera(scenery.fov, 1, 2, 120_000);
  // The controls drive this invisible camera; the real one springs after it.
  const proxy = new PerspectiveCamera(scenery.fov, 1, 2, 120_000);
  const controls = new OrbitControls(proxy, renderer.domElement);
  // Calibrated to feel like a heavy camera on a tripod: about half the stock
  // sensitivity, with inertia that settles quickly instead of spinning on.
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.38;
  controls.zoomSpeed = 0.55;
  controls.panSpeed = 0.6;
  const configureControls = (next: CameraMode) => {
    controls.enabled = next !== 'top';
    controls.enablePan = next === 'orbit';
    controls.minDistance = next === 'follow' ? 30 : 40;
    controls.maxDistance = next === 'follow' ? 400 : span * 6;
    // Following, the camera may drop to the drone's own height for a true side view.
    controls.maxPolarAngle = MathUtils.degToRad(next === 'follow' ? 100 : 86);
  };
  configureControls('orbit');

  const overview = () => {
    proxy.position.set(...scenery.overview.position);
    controls.target.set(...scenery.overview.target);
    controls.update();
  };
  overview();
  const camPos = new SpringVector();
  const camTarget = new SpringVector();
  camPos.jump(proxy.position);
  camTarget.jump(controls.target);
  const fovVelocity = { v: 0 };

  // Top-down is a floor plan: drag to pan, scroll to zoom towards the pointer.
  const TOP_FOV = 40;
  const tallest = Math.max(0, ...maze.obstacles.map((o) => o.heightCm ?? 0));
  const fitHeight = () => {
    const halfView = Math.max(maze.heightCm / 2, maze.widthCm / 2 / camera.aspect) * 1.12;
    return halfView / Math.tan(MathUtils.degToRad(TOP_FOV / 2)) + tallest / 2;
  };
  const topView = { x: 0, z: 0, height: 0 };
  const resetTopView = () => Object.assign(topView, { x: 0, z: 0, height: fitHeight() });
  const clampTopView = () => {
    const fit = fitHeight();
    topView.height = MathUtils.clamp(topView.height, tallest + 60, fit * 1.6);
    topView.x = MathUtils.clamp(topView.x, -maze.widthCm / 2, maze.widthCm / 2);
    topView.z = MathUtils.clamp(topView.z, -maze.heightCm / 2, maze.heightCm / 2);
  };
  const topWorldPerPixel = () => (2 * topView.height * Math.tan(MathUtils.degToRad(TOP_FOV / 2))) / Math.max(1, container.clientHeight);

  // Camera buttons and arrow keys: queued, then eased in over a few frames.
  const nudge = { az: 0, el: 0, zoom: 0 };
  const spherical = new Spherical();
  // Looking straight down, "up" on screen must be fixed, or the view spins
  // at random. Top-down puts the 0,0 corner at the top-left, like the map.
  const WORLD_UP = new Vector3(0, 1, 0);
  const TOP_DOWN_UP = new Vector3(0, 0, -1);

  let mode: CameraMode = 'orbit';
  let modeChangeBlend = 0;
  let followView: FollowView = 'behind';
  // Follow camera offset in the drone's own frame (forward, right, up), so it
  // turns with the drone: a right-side view stays on the drone's right.
  const followOffset = new Vector3();
  let followTransition: Orbit | null = null;
  let followReady = false;
  let followHeading: number | null = null;
  const followHeadingVelocity = { v: 0 };
  let armScale = 1;
  const armVelocity = { v: 0 };
  // A drag takes over from an unfinished swing to a preset view.
  controls.addEventListener('start', () => {
    followTransition = null;
  });

  let snapshot: WorldSnapshot | null = null;
  let flightHeight = DEFAULT_FLIGHT_HEIGHT_CM;
  let propSpeed = 0;
  let crashStartedAt: number | null = null;
  let crashFromAltitude = flightHeight;
  let lastTrail: readonly Point[] | null = null;
  let lastVisited: ReadonlySet<string> | null = null;

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = proxy.aspect = width / height;
    camera.updateProjectionMatrix();
    proxy.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // Weak classroom GPUs: if frames stay slow, render at a lower resolution.
  const MIN_PIXEL_RATIO = 0.5;
  let slowFrames = 0;
  const adaptQuality = (frameSeconds: number) => {
    slowFrames = frameSeconds > 1 / 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames >= 20 && pixelRatio > MIN_PIXEL_RATIO) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio * 0.75);
      renderer.setPixelRatio(pixelRatio);
      resize();
      slowFrames = 0;
    }
  };

  // ---------- Measuring tool ----------
  let measureMode = false;
  let measureFirst: SnappedPoint | null = null;
  let measureResult: Measurement | null = null;
  const keys = keyPoints(maze);
  const dotTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      // White dot with a dark rim: readable on light floors and dark grass alike.
      ctx.fillStyle = '#101828';
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(32, 32, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    return new CanvasTexture(c);
  })();
  const ringTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    return new CanvasTexture(c);
  })();
  // Points keep a constant on-screen size, so markers are easy to see and hit at any zoom.
  const marker = (size: number, color: string, map: CanvasTexture, count: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    const points = new Points(
      geometry,
      new PointsMaterial({ size, color, map, sizeAttenuation: false, transparent: true, alphaTest: 0.2, depthTest: false }),
    );
    points.frustumCulled = false;
    points.renderOrder = 11;
    points.visible = false;
    scene.add(points);
    return points;
  };
  const toWorldPoint = (p: SnappedPoint, out = new Vector3()) => {
    const w = arenaToWorld(maze, p.point.x, p.point.y, p.point.heightCm + 0.4);
    return out.set(w.x, w.y, w.z);
  };
  const setPositions = (points: Points, list: readonly Vector3[]) => {
    const attr = points.geometry.getAttribute('position') as Float32BufferAttribute;
    list.forEach((v, i) => attr.setXYZ(i, v.x, v.y, v.z));
    attr.needsUpdate = true;
    points.geometry.setDrawRange(0, list.length);
  };
  // Faint dots on every snappable point while measuring.
  const snapDots = marker(10, '#ffffff', dotTexture, keys.length);
  setPositions(snapDots, keys.map((k) => toWorldPoint({ point: k.point, label: k.label })));
  (snapDots.material as PointsMaterial).opacity = 0.85;
  const pins = marker(15, '#facc15', dotTexture, 2);
  const hoverRing = marker(26, '#facc15', ringTexture, 1);
  const tape = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#facc15', depthTest: false, transparent: true }));
  // Dashed "across" and "along" legs show how to lay the distance out with a tape measure.
  const legs = new Line(
    new BufferGeometry(),
    new LineDashedMaterial({ color: '#1d2939', dashSize: 4, gapSize: 3, depthTest: false, transparent: true, opacity: 0.75 }),
  );
  for (const m of [tape, legs]) {
    m.frustumCulled = false;
    m.renderOrder = 10;
    m.visible = false;
    scene.add(m);
  }
  const label = document.createElement('div');
  label.className = 'measure-label';
  label.hidden = true;
  container.appendChild(label);
  const hoverLabel = document.createElement('div');
  hoverLabel.className = 'measure-hover';
  hoverLabel.hidden = true;
  container.appendChild(hoverLabel);

  /** Draws the tape from A to B (B may be the live pointer position). */
  const drawTape = (a: SnappedPoint, b: SnappedPoint | null) => {
    const pa = toWorldPoint(a);
    pins.visible = true;
    if (!b) {
      setPositions(pins, [pa]);
      tape.visible = legs.visible = false;
      label.hidden = true;
      return;
    }
    const pb = toWorldPoint(b);
    setPositions(pins, [pa, pb]);
    tape.geometry.setFromPoints([pa, pb]);
    const corner = new Vector3(pb.x, pa.y, pa.z);
    legs.geometry.setFromPoints([pa, corner, pb]);
    legs.computeLineDistances();
    tape.visible = true;
    legs.visible = Math.abs(pa.x - pb.x) > 1 && Math.abs(pa.z - pb.z) > 1;
    label.textContent = `${measureBetween(a, b).distanceCm} cm`;
    label.hidden = false;
  };
  const showMeasurement = () => {
    if (measureResult) drawTape(measureResult.a, measureResult.b);
    else if (measureFirst) drawTape(measureFirst, null);
    else {
      pins.visible = tape.visible = legs.visible = false;
      label.hidden = true;
    }
    options.onMeasure?.({ first: measureFirst, result: measureResult });
  };
  const clearMeasurement = () => {
    measureFirst = null;
    measureResult = null;
    showMeasurement();
  };

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const projected = new Vector3();
  const pick = (event: PointerEvent): SnappedPoint | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    pointer.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...objects.pickables, ...scenery.pickables], false)[0];
    const candidates: SnapCandidate[] = [];
    for (const key of keys) {
      toWorldPoint({ point: key.point, label: key.label }, projected).project(camera);
      if (projected.z > 1) continue;
      const px = ((projected.x + 1) / 2) * rect.width;
      const py = ((1 - projected.y) / 2) * rect.height;
      candidates.push({ key, screenDistance: Math.hypot(px - sx, py - sy) });
    }
    const snapped = chooseSnap(candidates, hit ? hit.point.y : null, SNAP_RADIUS_PX);
    if (snapped) return { point: snapped.point, label: snapped.label };
    if (!hit) return null;
    return freePoint({ x: hit.point.x + maze.widthCm / 2, y: hit.point.z + maze.heightCm / 2, heightCm: hit.point.y });
  };

  let downAt: { x: number; y: number } | null = null;
  let lastDrag: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    downAt = { x: event.clientX, y: event.clientY };
    lastDrag = downAt;
  };
  const onPointerUp = (event: PointerEvent) => {
    const click = downAt !== null && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 5;
    downAt = lastDrag = null;
    if (!measureMode || !click || event.button !== 0) return;
    const p = pick(event);
    if (!p) return;
    if (measureFirst === null) {
      measureFirst = p;
      measureResult = null;
    } else {
      measureResult = measureBetween(measureFirst, p);
      measureFirst = null;
    }
    showMeasurement();
  };
  const onPointerMove = (event: PointerEvent) => {
    // Top-down: drag pans the floor plan.
    if (mode === 'top' && downAt !== null && lastDrag !== null && (event.buttons & 1) === 1) {
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) >= 5;
      if (moved) {
        const wpp = topWorldPerPixel();
        topView.x -= (event.clientX - lastDrag.x) * wpp;
        topView.z -= (event.clientY - lastDrag.y) * wpp;
        clampTopView();
        hoverRing.visible = false;
        hoverLabel.hidden = true;
      }
      lastDrag = { x: event.clientX, y: event.clientY };
      return;
    }
    if (!measureMode || downAt !== null) return;
    const p = pick(event);
    hoverRing.visible = p !== null;
    hoverLabel.hidden = p === null;
    if (!p) return;
    setPositions(hoverRing, [toWorldPoint(p)]);
    const rect = renderer.domElement.getBoundingClientRect();
    hoverLabel.textContent = p.label ? `${p.label} · ${formatPoint(p.point)}` : formatPoint(p.point);
    hoverLabel.style.left = `${event.clientX - rect.left}px`;
    hoverLabel.style.top = `${event.clientY - rect.top}px`;
    // Rubber band: the tape follows the pointer until the second click.
    if (measureFirst) drawTape(measureFirst, p);
  };
  const onPointerLeave = () => {
    hoverRing.visible = false;
    hoverLabel.hidden = true;
    if (measureFirst && !measureResult) drawTape(measureFirst, null);
  };
  const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  const onWheel = (event: WheelEvent) => {
    if (mode !== 'top') return;
    event.preventDefault();
    // Zoom towards the point under the pointer, like a map.
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const under = raycaster.ray.intersectPlane(floorPlane, new Vector3());
    const before = topView.height;
    topView.height *= Math.exp(MathUtils.clamp(event.deltaY, -120, 120) * 0.0018);
    clampTopView();
    if (under) {
      const k = topView.height / before;
      topView.x = under.x + (topView.x - under.x) * k;
      topView.z = under.z + (topView.z - under.z) * k;
      clampTopView();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (measureMode && event.key === 'Escape') clearMeasurement();
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  const labelAt = new Vector3();

  // ---------- Render loop ----------
  const timer = new Timer();
  timer.connect(document);
  const dronePos = new Vector3();
  const desired = new Vector3();
  const desiredTarget = new Vector3();
  const target = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const offset = new Vector3();
  const localFromOrbit = (o: Orbit, out: Vector3) => {
    const az = MathUtils.degToRad(o.azimuthDeg);
    const el = MathUtils.degToRad(o.elevationDeg);
    return out.set(-Math.cos(az) * Math.cos(el) * o.distance, Math.sin(az) * Math.cos(el) * o.distance, Math.sin(el) * o.distance);
  };
  const orbitFromLocal = (local: Vector3): Orbit => {
    const distance = Math.max(1e-6, local.length());
    return {
      azimuthDeg: MathUtils.radToDeg(Math.atan2(local.y, -local.x)),
      elevationDeg: MathUtils.radToDeg(Math.asin(MathUtils.clamp(local.z / distance, -1, 1))),
      distance,
    };
  };
  /** Eases queued camera-button moves into the proxy camera (orbit / follow) or the floor plan (top). */
  const applyNudge = (dt: number) => {
    if (Math.abs(nudge.az) + Math.abs(nudge.el) + Math.abs(nudge.zoom) < 1e-4) return;
    const k = smoothing(7, dt);
    const dAz = nudge.az * k;
    const dEl = nudge.el * k;
    const dZoom = nudge.zoom * k;
    nudge.az -= dAz;
    nudge.el -= dEl;
    nudge.zoom -= dZoom;
    if (mode === 'top') {
      topView.height *= Math.exp(dZoom);
      clampTopView();
      return;
    }
    offset.copy(proxy.position).sub(controls.target);
    spherical.setFromVector3(offset);
    spherical.theta += dAz;
    spherical.phi = MathUtils.clamp(spherical.phi - dEl, 0.08, controls.maxPolarAngle);
    spherical.radius = MathUtils.clamp(spherical.radius * Math.exp(dZoom), controls.minDistance, controls.maxDistance);
    proxy.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  };
  const toWorld = (local: Vector3) => offset.set(0, local.z, 0).addScaledVector(forward, local.x).addScaledVector(right, local.y);
  let handle = 0;

  const render = () => {
    handle = requestAnimationFrame(render);
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    adaptQuality(rawDt);
    const now = timer.getElapsed();

    scenery.update(now);
    objects.update(now);

    const snap = snapshot;
    const timeline = snap?.timeline;
    const elapsed = snap?.elapsed ?? 0;
    const phase = snap?.phase ?? 'idle';
    const pose = timeline ? frameAt(timeline, elapsed).pose : { ...maze.start, headingDeg: maze.startHeadingDeg, altitude: 0 };

    let altitude = pose.altitude * flightHeight;
    let pitch = 0;
    let roll = 0;
    if (timeline && phase !== 'idle') {
      const attitude = attitudeAt(timeline, elapsed);
      pitch = attitude.pitchDeg;
      roll = attitude.rollDeg;
    }
    // Real multirotors never hold perfectly still: add a gentle hover wobble.
    const wobble = hoverWobble(now, pose.altitude);
    altitude += wobble.dyCm;
    pitch += wobble.pitchDeg;
    roll += wobble.rollDeg;

    // After a collision the drone loses lift and drops to the ground.
    const crashed = phase === 'finished' && snap?.failure?.contactPoint !== undefined;
    let shake = 0;
    if (crashed) {
      if (crashStartedAt === null) {
        crashStartedAt = now;
        crashFromAltitude = altitude;
      }
      const sinceCrash = now - crashStartedAt;
      const fall = crashFall(crashFromAltitude, sinceCrash);
      altitude = fall.altitudeCm;
      pitch = fall.tiltDeg * 0.6;
      roll = fall.tiltDeg;
      shake = 2.2 * Math.exp(-5 * sinceCrash);
    } else {
      crashStartedAt = null;
    }

    const targetSpin = crashed ? 0 : pose.altitude > 0.001 ? 0.75 + 0.25 * pose.altitude : 0;
    propSpeed += (targetSpin - propSpeed) * smoothing(crashed ? 6 : 3, dt);
    drone.spinProps(propSpeed, dt);

    const w = arenaToWorld(maze, pose.x, pose.y, altitude + 0.6);
    dronePos.set(w.x, w.y, w.z);
    drone.root.position.copy(dronePos);
    drone.root.rotation.set(MathUtils.degToRad(-pitch), headingToYaw(pose.headingDeg), MathUtils.degToRad(-roll));
    objects.setFootprint(pose);

    modeChangeBlend = Math.max(0, modeChangeBlend - dt / 1.2);
    const boost = MODE_CHANGE_SMOOTHING * modeChangeBlend * modeChangeBlend;
    let targetFov = scenery.fov;

    if (mode === 'orbit') {
      applyNudge(dt);
      controls.update();
      if (scenery.orbitBounds) clampToBounds(proxy.position, scenery.orbitBounds);
      desired.copy(proxy.position);
      desiredTarget.copy(controls.target);
    } else if (mode === 'follow') {
      // Aim at the drone's flight position (ignoring the hover bob, so the
      // view stays steady), a little ahead of where it is going.
      const t = arenaToWorld(maze, pose.x, pose.y, Math.max(crashed ? altitude : pose.altitude * flightHeight, 8));
      target.set(t.x, t.y, t.z);
      if (timeline && phase === 'running') {
        const ahead = frameAt(timeline, Math.min(timeline.totalSeconds, elapsed + LOOK_AHEAD_SECONDS)).pose;
        target.x += (ahead.x - pose.x) * 0.5;
        target.z += (ahead.y - pose.y) * 0.5;
      }
      // The camera turns with the drone, but swings round gently behind it
      // (like a camera operator), so turns never feel like a whip-pan.
      followHeading = followHeading === null ? pose.headingDeg : smoothDamp(followHeading, pose.headingDeg, followHeadingVelocity, FOLLOW_TURN_LAG_SECONDS, dt);
      const f = headingVector(followHeading);
      const r = headingVector(followHeading + 90);
      forward.set(f.x, 0, f.y);
      right.set(r.x, 0, r.y);

      if (!followReady) {
        // Start the swing from wherever the camera is now.
        offset.copy(camPos.value).sub(target);
        followOffset.set(offset.dot(forward), offset.dot(right), offset.y);
        followReady = true;
      }
      if (followTransition) {
        const current = orbitFromLocal(followOffset);
        const k = smoothing(4, dt);
        const next: Orbit = {
          azimuthDeg: current.azimuthDeg + angleDelta(current.azimuthDeg, followTransition.azimuthDeg) * k,
          elevationDeg: current.elevationDeg + (followTransition.elevationDeg - current.elevationDeg) * k,
          distance: current.distance + (followTransition.distance - current.distance) * k,
        };
        localFromOrbit(next, followOffset);
        const done =
          Math.abs(angleDelta(next.azimuthDeg, followTransition.azimuthDeg)) < 0.2 &&
          Math.abs(next.elevationDeg - followTransition.elevationDeg) < 0.2 &&
          Math.abs(next.distance - followTransition.distance) < 0.5;
        if (done) followTransition = null;
      }

      proxy.position.copy(target).add(toWorld(followOffset));
      controls.target.copy(target);
      applyNudge(dt);
      controls.update(); // applies the student's drag / zoom
      offset.copy(proxy.position).sub(target);
      followOffset.set(offset.dot(forward), offset.dot(right), offset.y);

      // Spring arm: if a box, wall or the net would hide the drone, pull in
      // at once; when the way is clear again, ease back out slowly.
      const clear = Math.max(Math.min(1, 25 / Math.max(1, offset.length())), clearViewScale(maze, target, offset, scenery.followBounds));
      armScale = clear < armScale ? clear : smoothDamp(armScale, clear, armVelocity, 0.5, dt);
      desired.copy(target).addScaledVector(offset, armScale);
      desired.y = Math.max(desired.y, 6);
      desiredTarget.copy(target);
    } else {
      // Straight down onto the floor plan (indoors the ceiling is cut away).
      targetFov = TOP_FOV;
      applyNudge(dt);
      desired.set(topView.x, topView.height, topView.z + 0.01);
      desiredTarget.set(topView.x, 0, topView.z);
    }

    const smooth = CAMERA_SMOOTHING[mode];
    camPos.step(desired, smooth.position + boost, dt);
    camTarget.step(desiredTarget, smooth.target + boost, dt);
    camera.position.copy(camPos.value);
    if (mode === 'follow') {
      // Never let the lagging camera end up inside a box or behind the net.
      offset.copy(camera.position).sub(camTarget.value);
      camera.position.copy(camTarget.value).addScaledVector(offset, clearViewScale(maze, camTarget.value, offset, scenery.followBounds));
      objects.fadeOccluders(camera.position, camTarget.value);
    }
    if (shake > 0.01) {
      camera.position.x += shake * Math.sin(now * 47);
      camera.position.y += shake * Math.sin(now * 61 + 1.3);
      camera.position.z += shake * Math.sin(now * 53 + 2.1);
    }
    camera.up.lerp(mode === 'top' ? TOP_DOWN_UP : WORLD_UP, smoothing(6, dt)).normalize();
    camera.lookAt(camTarget.value);
    const fov = smoothDamp(camera.fov, targetFov, fovVelocity, 0.3, dt);
    if (Math.abs(fov - camera.fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);

    snapDots.visible = measureMode;
    if (tape.visible) {
      // Keep the distance label pinned to the middle of the tape.
      const attr = pins.geometry.getAttribute('position') as Float32BufferAttribute;
      labelAt.set((attr.getX(0) + attr.getX(1)) / 2, (attr.getY(0) + attr.getY(1)) / 2, (attr.getZ(0) + attr.getZ(1)) / 2).project(camera);
      const visible = labelAt.z < 1;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${((labelAt.x + 1) / 2) * 100}%`;
        label.style.top = `${((1 - labelAt.y) / 2) * 100}%`;
      }
    }
  };
  render();

  return {
    setSnapshot(next) {
      snapshot = next;
      if (next.trail !== lastTrail) {
        lastTrail = next.trail;
        objects.setTrail(next.phase === 'idle' ? [] : next.trail);
      }
      if (next.visitedCheckpoints !== lastVisited) {
        lastVisited = next.visitedCheckpoints;
        objects.setVisitedCheckpoints(next.visitedCheckpoints);
      }
      const contact = next.failure?.contactPoint;
      objects.setCrashPoint(next.phase === 'finished' && contact ? contact : null);
    },
    setCameraMode(next) {
      if (next === mode) return;
      mode = next;
      modeChangeBlend = 1;
      scenery.setCutaway(next === 'top');
      objects.fadeOccluders(null, null);
      configureControls(next);
      if (next === 'orbit') overview();
      if (next === 'top') resetTopView();
      if (next === 'follow') {
        followReady = false;
        followHeading = null;
        armScale = 1;
        followTransition = { ...FOLLOW_VIEWS[followView] };
      }
    },
    setFollowView(next) {
      followView = next;
      if (mode === 'follow') followTransition = { ...FOLLOW_VIEWS[next] };
    },
    setShowGrid(show) {
      objects.setShowGrid(show);
    },
    setFlightHeight(heightCm) {
      flightHeight = heightCm;
      objects.setFlightHeight(heightCm);
    },
    setMeasureMode(on) {
      measureMode = on;
      renderer.domElement.style.cursor = on ? 'crosshair' : '';
      hoverRing.visible = false;
      hoverLabel.hidden = true;
      if (!on) clearMeasurement();
    },
    clearMeasurement,
    nudgeCamera(action) {
      if (action === 'recenter') {
        nudge.az = nudge.el = nudge.zoom = 0;
        if (mode === 'orbit') overview();
        else if (mode === 'top') resetTopView();
        else followTransition = { ...FOLLOW_VIEWS[followView] };
        return;
      }
      followTransition = null;
      if (action === 'rotate-left') nudge.az -= NUDGE_ROTATE;
      if (action === 'rotate-right') nudge.az += NUDGE_ROTATE;
      if (action === 'tilt-up') nudge.el += NUDGE_TILT;
      if (action === 'tilt-down') nudge.el -= NUDGE_TILT;
      if (action === 'zoom-in') nudge.zoom -= NUDGE_ZOOM;
      if (action === 'zoom-out') nudge.zoom += NUDGE_ZOOM;
    },
    dispose() {
      cancelAnimationFrame(handle);
      timer.dispose();
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      label.remove();
      hoverLabel.remove();
      scenery.dispose();
      scene.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
        const materials = ([] as Material[]).concat((mesh.material as Material | Material[] | undefined) ?? []);
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
          }
          material.dispose();
        }
      });
      (scene.environment as Texture | null)?.dispose();
      renderer.dispose();
      // Free the GPU context right away (maze switches, React StrictMode remounts).
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
