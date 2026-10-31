/**
 * 3D versions of the maze elements, built from the MazeDefinition data at
 * their real measured sizes. Classroom: stacked cardboard boxes, cones and
 * floor tape. Forest: wooden crates, concrete walls and a netted cage.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D, Texture, Vector3 } from 'three';
import { ARENA_CONE_INSET_CM } from '../mazes/cones';
import { DEFAULT_FLIGHT_HEIGHT_CM, DEFAULT_OBSTACLE_HEIGHT_CM } from '../mazes/constants';
import type { MazeDefinition, Obstacle, Point } from '../mazes/types';
import { arenaToWorld, seededRandom } from './coords';
import type { ThemeId } from './themeOptions';
import { arenaTexture, cardboardTexture, concreteTexture, coneTexture, netTexture, woodTexture } from './textures';

const NO_FLY_HEIGHT_CM = 230;
/** Indoors the red airspace column stops well below the ceiling, so it reads as a hint, not a wall. */
const NO_FLY_HEIGHT_INDOOR_CM = 150;
const NET_HEIGHT_CM = 220;
/** A typical classroom cardboard box is about this tall and wide. */
const BOX_LEVEL_CM = 40;
const BOX_MAX_WIDTH_CM = 50;
const CONE_HEIGHT_CM = 30;

export interface MazeObjects {
  readonly root: Group;
  /** Meshes a measuring click can land on (floor and obstacles). */
  readonly pickables: readonly Object3D[];
  setShowGrid(show: boolean): void;
  setFlightHeight(heightCm: number): void;
  setVisitedCheckpoints(ids: ReadonlySet<string>): void;
  setTrail(points: readonly Point[]): void;
  setCrashPoint(point: Point | null): void;
  /** Ring on the ground under the drone showing its collision radius. */
  setFootprint(point: Point): void;
  update(elapsedSeconds: number): void;
  /**
   * Fade thin posts, poles and cones standing between the camera and the
   * drone, so they never hide it. Pass null to show everything normally.
   */
  fadeOccluders(camera: Vector3 | null, drone: Vector3 | null): void;
}

/** Distance from (px, pz) to the segment (ax, az)-(bx, bz) on the ground plane. */
function groundSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

const OCCLUDER_FADE_CM = 9;
const OCCLUDER_FADED_OPACITY = 0.18;

function isCrate(o: Obstacle): boolean {
  return Math.min(o.width, o.height) >= 25;
}

export function createMazeObjects(maze: MazeDefinition, theme: ThemeId): MazeObjects {
  const classroom = theme === 'classroom';
  const root = new Group();
  root.name = 'maze';
  const pickables: Object3D[] = [];
  // Thin vertical things that may stand between the follow camera and the drone.
  const occluders: Array<{ object: Object3D; material: Material & { opacity: number } }> = [];
  const addOccluder = (object: Object3D, material: Material & { opacity: number }) => {
    material.transparent = true;
    occluders.push({ object, material });
  };
  const at = (x: number, y: number, alt = 0) => {
    const p = arenaToWorld(maze, x, y, alt);
    return [p.x, p.y, p.z] as const;
  };

  // Floor markings: turf field (forest) or tape on the classroom floor.
  const floorMat = new MeshStandardMaterial({ roughness: classroom ? 0.6 : 0.95, transparent: classroom });
  let floorTexture: Texture | null = null;
  const floor = new Mesh(new PlaneGeometry(maze.widthCm, maze.heightCm), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = classroom ? 0.15 : 0.4;
  floor.receiveShadow = true;
  floor.name = 'arena-floor';
  root.add(floor);
  pickables.push(floor);
  const setShowGrid = (show: boolean) => {
    floorTexture?.dispose();
    floorTexture = arenaTexture(maze, show, theme);
    floorMat.map = floorTexture;
    floorMat.needsUpdate = true;
  };
  setShowGrid(true);

  // Traffic cones (classroom): arena corners, no-fly corners, checkpoints.
  const coneMat = new MeshStandardMaterial({ map: coneTexture(), roughness: 0.5 });
  const coneBaseMat = new MeshStandardMaterial({ color: '#e85d0c', roughness: 0.6 });
  const coneGeo = new CylinderGeometry(1.4, 7.5, CONE_HEIGHT_CM - 2, 24, 1, true);
  const coneBaseGeo = new BoxGeometry(18, 2, 18);
  const addCone = (x: number, y: number) => {
    const cone = new Group();
    const bodyMat = coneMat.clone();
    const body = new Mesh(coneGeo, bodyMat);
    body.position.y = 2 + (CONE_HEIGHT_CM - 2) / 2;
    const base = new Mesh(coneBaseGeo, coneBaseMat);
    base.position.y = 1;
    cone.add(body, base);
    cone.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    cone.position.set(...at(x, y));
    addOccluder(cone, bodyMat);
    root.add(cone);
  };

  if (classroom) {
    const inset = ARENA_CONE_INSET_CM;
    for (const [x, y] of [
      [inset, inset],
      [maze.widthCm - inset, inset],
      [inset, maze.heightCm - inset],
      [maze.widthCm - inset, maze.heightCm - inset],
    ] as const) {
      addCone(x, y);
    }
  } else {
    // Safety cage: posts and translucent netting around the arena.
    const postMat = new MeshStandardMaterial({ color: '#d7dde3', metalness: 0.6, roughness: 0.35 });
    const postGeo = new CylinderGeometry(1.6, 1.6, NET_HEIGHT_CM, 10);
    const net = netTexture();
    const sides: Array<[number, number, number, number]> = [
      [0, 0, maze.widthCm, 0],
      [maze.widthCm, 0, maze.widthCm, maze.heightCm],
      [maze.widthCm, maze.heightCm, 0, maze.heightCm],
      [0, maze.heightCm, 0, 0],
    ];
    for (const [x1, y1, x2, y2] of sides) {
      const length = Math.hypot(x2 - x1, y2 - y1);
      const posts = Math.max(1, Math.round(length / 100));
      for (let i = 0; i < posts; i++) {
        const t = i / posts;
        const material = postMat.clone();
        const post = new Mesh(postGeo, material);
        addOccluder(post, material);
        post.position.set(...at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, NET_HEIGHT_CM / 2));
        post.castShadow = true;
        root.add(post);
      }
      const tex = net.clone();
      tex.repeat.set(length / 20, NET_HEIGHT_CM / 20);
      tex.needsUpdate = true;
      const panel = new Mesh(
        new PlaneGeometry(length, NET_HEIGHT_CM),
        new MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.18, alphaTest: 0.05, side: DoubleSide, depthWrite: false }),
      );
      panel.position.set(...at((x1 + x2) / 2, (y1 + y2) / 2, NET_HEIGHT_CM / 2));
      panel.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
      root.add(panel);
    }
  }

  // Obstacles at their real measured size.
  if (classroom) {
    // Stacks of cardboard boxes that exactly fill each footprint and height.
    const rand = seededRandom(17);
    const boxMats = [1, 2, 3, 4].map((seed) => new MeshStandardMaterial({ map: cardboardTexture(seed), roughness: 0.85 }));
    for (const o of maze.obstacles) {
      const h = o.heightCm ?? DEFAULT_OBSTACLE_HEIGHT_CM;
      const cols = Math.max(1, Math.ceil(o.width / BOX_MAX_WIDTH_CM));
      const rows = Math.max(1, Math.ceil(o.height / BOX_MAX_WIDTH_CM));
      const levels = Math.max(1, Math.round(h / BOX_LEVEL_CM));
      const cw = o.width / cols;
      const rd = o.height / rows;
      const lh = h / levels;
      const stack = new Group();
      stack.name = `obstacle:${o.id}`;
      for (let level = 0; level < levels; level++) {
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            // Small random inset only, so boxes never poke outside the real footprint.
            const insetX = 0.3 + rand() * 1.2;
            const insetZ = 0.3 + rand() * 1.2;
            const mesh = new Mesh(
              new BoxGeometry(cw - insetX * 2, lh - 0.4, rd - insetZ * 2),
              boxMats[Math.floor(rand() * boxMats.length)]!,
            );
            mesh.position.set(...at(o.x + cw * (c + 0.5), o.y + rd * (r + 0.5), lh * level + lh / 2));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            stack.add(mesh);
            pickables.push(mesh);
          }
        }
      }
      root.add(stack);
    }
  } else {
    const wood = woodTexture();
    const concrete = concreteTexture();
    for (const o of maze.obstacles) {
      const h = o.heightCm ?? DEFAULT_OBSTACLE_HEIGHT_CM;
      const crate = isCrate(o);
      const map = (crate ? wood : concrete).clone();
      map.repeat.set(Math.max(1, Math.max(o.width, o.height) / (crate ? 40 : 60)), Math.max(1, h / (crate ? 40 : 60)));
      map.needsUpdate = true;
      const mesh = new Mesh(new BoxGeometry(o.width, h, o.height), new MeshStandardMaterial({ map, roughness: crate ? 0.8 : 0.92 }));
      mesh.position.set(...at(o.x + o.width / 2, o.y + o.height / 2, h / 2));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `obstacle:${o.id}`;
      root.add(mesh);
      pickables.push(mesh);
    }
  }

  // No-fly zones: a faint red column shows the airspace is off limits.
  const zoneMat = new MeshStandardMaterial({
    color: '#ff2d2d',
    emissive: '#a00000',
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: classroom ? 0.07 : 0.16,
    depthWrite: false,
    side: DoubleSide,
  });
  const baseZoneOpacity = zoneMat.opacity;
  const zoneEdgeMat = new LineBasicMaterial({ color: '#ff4040', transparent: true, opacity: classroom ? 0.25 : 0.9 });
  const zoneHeight = classroom ? NO_FLY_HEIGHT_INDOOR_CM : NO_FLY_HEIGHT_CM;
  for (const z of maze.noFlyZones) {
    const geo = new BoxGeometry(z.width, zoneHeight, z.height);
    const column = new Mesh(geo, zoneMat);
    column.position.set(...at(z.x + z.width / 2, z.y + z.height / 2, zoneHeight / 2));
    column.add(new LineSegments(new EdgesGeometry(geo), zoneEdgeMat));
    root.add(column);
    if (classroom) {
      const i = 6;
      addCone(z.x + i, z.y + i);
      addCone(z.x + z.width - i, z.y + i);
      addCone(z.x + i, z.y + z.height - i);
      addCone(z.x + z.width - i, z.y + z.height - i);
    }
  }

  // Checkpoints: a ring at flight height marks where the drone must pass
  // (over a cone in the classroom, beside a flag outdoors).
  interface CheckpointParts {
    readonly ring: MeshStandardMaterial;
    readonly beam: MeshBasicMaterial;
    readonly flag: MeshStandardMaterial | null;
    readonly ringMesh: Mesh;
    readonly beamMesh: Mesh;
  }
  const checkpointParts = new Map<string, CheckpointParts>();
  const poleMat = new MeshStandardMaterial({ color: '#d7dde3', metalness: 0.6, roughness: 0.35 });
  for (const cp of maze.checkpoints) {
    const ringMat = new MeshStandardMaterial({
      color: '#ff9f1a',
      emissive: '#ff8a00',
      emissiveIntensity: 1.2,
      transparent: classroom,
      opacity: classroom ? 0.55 : 1,
    });
    const ringMesh = new Mesh(new TorusGeometry(cp.radiusCm, classroom ? 0.5 : 0.9, 12, 48), ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.castShadow = !classroom;

    const beamMat = new MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide });
    const beamMesh = new Mesh(new CylinderGeometry(cp.radiusCm, cp.radiusCm, 1, 32, 1, true), beamMat);
    root.add(ringMesh, beamMesh);

    let flagMat: MeshStandardMaterial | null = null;
    if (classroom) {
      addCone(cp.x, cp.y);
    } else {
      const poleH = 130;
      const material = poleMat.clone();
      const pole = new Mesh(new CylinderGeometry(0.5, 0.5, poleH, 8), material);
      addOccluder(pole, material);
      const poleX = cp.x + cp.radiusCm + 6;
      pole.position.set(...at(poleX, cp.y, poleH / 2));
      pole.castShadow = true;
      const flagShape = new Shape();
      flagShape.moveTo(0, 0);
      flagShape.lineTo(16, -5);
      flagShape.lineTo(0, -10);
      flagShape.closePath();
      flagMat = new MeshStandardMaterial({ color: '#ff9f1a', side: DoubleSide, roughness: 0.7 });
      const flag = new Mesh(new ShapeGeometry(flagShape), flagMat);
      addOccluder(flag, flagMat);
      flag.position.set(...at(poleX, cp.y, poleH));
      flag.castShadow = true;
      root.add(pole, flag);
    }
    checkpointParts.set(cp.id, { ring: ringMat, beam: beamMat, flag: flagMat, ringMesh, beamMesh });
  }

  // Flight trail.
  const trailGeo = new BufferGeometry();
  const trail = new Line(trailGeo, new LineBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  root.add(trail);
  let trailPoints: readonly Point[] = [];
  let flightHeight = DEFAULT_FLIGHT_HEIGHT_CM;

  // Crash marker on the ground.
  const crash = new Group();
  const crashRing = new Mesh(
    new RingGeometry(maze.droneRadiusCm + 2, maze.droneRadiusCm + 6, 40),
    new MeshBasicMaterial({ color: '#e11d48', transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  crashRing.rotation.x = -Math.PI / 2;
  crash.add(crashRing);
  crash.visible = false;
  root.add(crash);

  // Footprint of the collision circle under the drone.
  const footprint = new Mesh(
    new CircleGeometry(maze.droneRadiusCm, 40),
    new MeshBasicMaterial({
      color: classroom ? '#1e3a8a' : '#ffffff',
      transparent: true,
      opacity: classroom ? 0.12 : 0.18,
      depthWrite: false,
    }),
  );
  footprint.rotation.x = -Math.PI / 2;
  root.add(footprint);

  const drawTrail = () => {
    const positions: number[] = [];
    for (const p of trailPoints) positions.push(...at(p.x, p.y, flightHeight));
    trailGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    trail.visible = trailPoints.length > 1;
  };

  const setFlightHeight = (heightCm: number) => {
    flightHeight = heightCm;
    for (const cp of maze.checkpoints) {
      const parts = checkpointParts.get(cp.id);
      if (!parts) continue;
      parts.ringMesh.position.set(...at(cp.x, cp.y, heightCm));
      const beamH = heightCm + 60;
      parts.beamMesh.scale.y = beamH;
      parts.beamMesh.position.set(...at(cp.x, cp.y, beamH / 2));
    }
    drawTrail();
  };
  setFlightHeight(flightHeight);

  return {
    root,
    pickables,
    setShowGrid,
    setFlightHeight,
    setVisitedCheckpoints(ids) {
      for (const [id, parts] of checkpointParts) {
        const visited = ids.has(id);
        const color = visited ? '#22c55e' : '#ff9f1a';
        parts.ring.color.set(color);
        parts.ring.emissive.set(visited ? '#16a34a' : '#ff8a00');
        parts.beam.color.set(visited ? '#4ade80' : '#ffb347');
        parts.flag?.color.set(color);
      }
    },
    setTrail(points) {
      trailPoints = points;
      drawTrail();
    },
    setCrashPoint(point) {
      crash.visible = point !== null;
      if (point) crash.position.set(...at(point.x, point.y, 0.8));
    },
    setFootprint(point) {
      footprint.position.set(...at(point.x, point.y, 0.7));
    },
    update(t) {
      // Slow "breathing" glow on hazards and checkpoint rings.
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
      zoneMat.opacity = baseZoneOpacity * (0.75 + 0.5 * pulse);
      for (const parts of checkpointParts.values()) parts.ring.emissiveIntensity = 0.8 + 0.8 * pulse;
    },
    fadeOccluders(camera, drone) {
      for (const { object, material } of occluders) {
        const { x, z } = object.position;
        const blocking =
          camera !== null && drone !== null && groundSegmentDistance(x, z, camera.x, camera.z, drone.x, drone.z) < OCCLUDER_FADE_CM;
        material.opacity = blocking ? OCCLUDER_FADED_OPACITY : 1;
        material.depthWrite = !blocking;
      }
    },
  };
}
