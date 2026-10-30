/**
 * Indoor classroom around the arena: tiled vinyl floor, painted walls, sunny
 * windows, whiteboard, door, clock, ceiling light panels, and desks and
 * chairs pushed back against the walls to clear the flying space.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  SRGBColorSpace,
} from 'three';
import type { Material, Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { MazeDefinition } from '../mazes/types';
import type { CameraBounds, Scenery } from './scenery';
import { floorTileTexture, wallPaintTexture } from './textures';

export const CLASSROOM_HEIGHT_CM = 300;
/** Clear floor between the arena edge and the walls. */
const MARGIN_X_CM = 230;
const MARGIN_Z_CM = 200;
const TILE_CM = 30;
const CAMERA_CLEARANCE_CM = 15;

function drawnTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  draw(ctx);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createClassroom(scene: Scene, renderer: WebGLRenderer, maze: MazeDefinition): Scenery {
  const halfX = maze.widthCm / 2 + MARGIN_X_CM;
  const halfZ = maze.heightCm / 2 + MARGIN_Z_CM;
  const H = CLASSROOM_HEIGHT_CM;
  const room = new Group();
  room.name = 'classroom';
  scene.add(room);
  scene.background = new Color('#d8d2c4');

  const add = (mesh: Mesh, x: number, y: number, z: number, shadows = true) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    room.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, material: Material) => new Mesh(new BoxGeometry(w, h, d), material);

  // Floor: 30 cm vinyl tiles, so students can count tiles as a rough ruler.
  const tiles = floorTileTexture();
  tiles.repeat.set((halfX * 2) / TILE_CM, (halfZ * 2) / TILE_CM);
  tiles.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new Mesh(new PlaneGeometry(halfX * 2, halfZ * 2), new MeshStandardMaterial({ map: tiles, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  add(floor, 0, 0, 0, false);

  // Walls and ceiling.
  const paint = wallPaintTexture();
  const walls: Array<[w: number, x: number, z: number, rotY: number]> = [
    [halfX * 2, 0, -halfZ, 0],
    [halfX * 2, 0, halfZ, Math.PI],
    [halfZ * 2, -halfX, 0, Math.PI / 2],
    [halfZ * 2, halfX, 0, -Math.PI / 2],
  ];
  const skirtingMat = new MeshStandardMaterial({ color: '#6b5b4a', roughness: 0.7 });
  for (const [w, x, z, rotY] of walls) {
    const tex = paint.clone();
    tex.repeat.set(w / 200, H / 200);
    const wall = new Mesh(new PlaneGeometry(w, H), new MeshStandardMaterial({ map: tex, roughness: 0.92 }));
    wall.rotation.y = rotY;
    add(wall, x, H / 2, z, false);
    const skirting = box(w, 10, 1.5, skirtingMat);
    skirting.rotation.y = rotY;
    add(skirting, x * 0.998, 5, z * 0.998, false);
  }
  const ceiling = new Mesh(new PlaneGeometry(halfX * 2, halfZ * 2), new MeshStandardMaterial({ color: '#f3f1ec', roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  add(ceiling, 0, H, 0, false);

  // Ceiling light panels (hidden for the top-down cutaway view).
  const overhead = new Group();
  room.add(overhead);
  const panelMat = new MeshStandardMaterial({ color: '#ffffff', emissive: '#fffbf0', emissiveIntensity: 1.6 });
  const panelFrame = new MeshStandardMaterial({ color: '#c9c9c4', roughness: 0.6 });
  for (let x = -halfX + 180; x <= halfX - 180; x += 240) {
    for (let z = -halfZ + 150; z <= halfZ - 150; z += 200) {
      overhead.add(add(box(124, 2, 64, panelFrame), x, H - 1, z, false));
      overhead.add(add(box(118, 1, 58, panelMat), x, H - 2.2, z, false));
    }
  }

  // Windows along the right-hand wall, with a bright sky outside.
  const skyTex = drawnTexture(64, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#8fbfe8');
    g.addColorStop(0.7, '#d7ecfb');
    g.addColorStop(1, '#a9c99a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 128);
  });
  const glassMat = new MeshBasicMaterial({ map: skyTex });
  const frameMat = new MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.5 });
  const windowW = 150;
  const windowH = 130;
  const sill = 95;
  for (let z = -halfZ + 140; z <= halfZ - 140; z += 210) {
    const glass = new Mesh(new PlaneGeometry(windowW, windowH), glassMat);
    glass.rotation.y = -Math.PI / 2;
    add(glass, halfX - 0.5, sill + windowH / 2, z, false);
    for (const dy of [0, windowH]) add(box(6, 6, windowW + 6, frameMat), halfX - 2, sill + dy, z, false);
    for (const dz of [-windowW / 2, 0, windowW / 2]) add(box(6, windowH, 5, frameMat), halfX - 2, sill + windowH / 2, z + dz, false);
    add(box(14, 3, windowW + 10, frameMat), halfX - 7, sill - 1.5, z, false);
  }

  // Whiteboard on the far wall.
  const boardTex = drawnTexture(512, 240, (ctx) => {
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, 512, 240);
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, 512, 240);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('BIRDS Drone Lab', 28, 56);
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 4;
    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#16a34a';
    ctx.fillText('1. Takeoff   2. Move   3. Land', 30, 110);
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(40, 190);
    ctx.lineTo(160, 190);
    ctx.lineTo(160, 140);
    ctx.lineTo(300, 140);
    ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.font = '18px sans-serif';
    ctx.fillText('measure twice, fly once!', 300, 205);
  });
  add(box(250, 120, 2, new MeshStandardMaterial({ color: '#b9bdc2', metalness: 0.6, roughness: 0.4 })), 0, 150, -halfZ + 1, false);
  const board = new Mesh(new PlaneGeometry(240, 110), new MeshStandardMaterial({ map: boardTex, roughness: 0.25 }));
  add(board, 0, 150, -halfZ + 2.2, false);
  add(box(240, 3, 8, new MeshStandardMaterial({ color: '#9ca3af', metalness: 0.5, roughness: 0.4 })), 0, 89, -halfZ + 5, false);

  // Wall clock.
  const clockTex = drawnTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
      ctx.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      ctx.stroke();
    }
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64, 28);
    ctx.moveTo(64, 64);
    ctx.lineTo(90, 70);
    ctx.stroke();
  });
  const clock = new Mesh(new CircleGeometry(16, 32), new MeshStandardMaterial({ map: clockTex, roughness: 0.3 }));
  add(clock, 190, 240, -halfZ + 1.5, false);
  const rim = new Mesh(new CylinderGeometry(17, 17, 2, 32), new MeshStandardMaterial({ color: '#1f2937', roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2;
  add(rim, 190, 240, -halfZ + 0.6, false);

  // Door near the front-left corner.
  const doorMat = new MeshStandardMaterial({ color: '#8a5a32', roughness: 0.6 });
  const door = box(95, 210, 4, doorMat);
  add(door, -halfX + 120, 105, halfZ - 2, false);
  add(box(10, 2, 3, new MeshStandardMaterial({ color: '#d1d5db', metalness: 0.9, roughness: 0.25 })), -halfX + 160, 100, halfZ - 5, false);

  // Notice board with pinned sheets on the left wall.
  const cork = drawnTexture(256, 160, (ctx) => {
    ctx.fillStyle = '#b98a5c';
    ctx.fillRect(0, 0, 256, 160);
    const colours = ['#fef08a', '#bfdbfe', '#fecaca', '#bbf7d0', '#ffffff'];
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = colours[i % colours.length]!;
      ctx.fillRect(14 + (i % 4) * 60, 14 + Math.floor(i / 4) * 72, 44, 56);
    }
  });
  const notice = new Mesh(new PlaneGeometry(200, 120), new MeshStandardMaterial({ map: cork, roughness: 0.9 }));
  notice.rotation.y = Math.PI / 2;
  add(notice, -halfX + 1.5, 160, -60, false);

  // Desks and chairs pushed back against the walls.
  const deskTop = new MeshStandardMaterial({ color: '#d9c7a3', roughness: 0.55 });
  const metal = new MeshStandardMaterial({ color: '#4b5563', metalness: 0.7, roughness: 0.35 });
  const seat = new MeshStandardMaterial({ color: '#2563eb', roughness: 0.6 });
  const desk = (x: number, z: number, rotY: number) => {
    const g = new Group();
    const top = box(120, 3, 60, deskTop);
    top.position.y = 73.5;
    g.add(top);
    for (const [lx, lz] of [[-56, -26], [56, -26], [-56, 26], [56, 26]] as const) {
      const leg = box(3, 72, 3, metal);
      leg.position.set(lx, 36, lz);
      g.add(leg);
    }
    for (const cx of [-30, 30]) {
      const chairSeat = box(40, 3, 40, seat);
      chairSeat.position.set(cx, 45, 38);
      const back = box(40, 32, 3, seat);
      back.position.set(cx, 70, 58);
      g.add(chairSeat, back);
      for (const [lx, lz] of [[-18, 20], [18, 20], [-18, 56], [18, 56]] as const) {
        const leg = box(2, 44, 2, metal);
        leg.position.set(cx + lx, 22, lz);
        g.add(leg);
      }
    }
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    room.add(g);
  };
  for (let z = -halfZ + 120; z <= halfZ - 120; z += 150) desk(-halfX + 45, z, -Math.PI / 2);
  desk(halfX - 260, -halfZ + 40, 0);

  // Lighting: soft room fill, a window sun for shadows, and a room
  // environment map for natural reflections on the drone and boxes.
  scene.add(new HemisphereLight('#fffaf0', '#b9ad95', 0.9));
  const sun = new DirectionalLight('#fff3dd', 2.2);
  sun.position.set(halfX + 400, 520, -160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -halfX, right: halfX, top: halfZ, bottom: -halfZ, near: 10, far: 2_500 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const pmrem = new PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;

  const bounds: CameraBounds = {
    minX: -halfX + CAMERA_CLEARANCE_CM,
    maxX: halfX - CAMERA_CLEARANCE_CM,
    minZ: -halfZ + CAMERA_CLEARANCE_CM,
    maxZ: halfZ - CAMERA_CLEARANCE_CM,
    maxY: H - CAMERA_CLEARANCE_CM,
  };
  return {
    followBounds: bounds,
    orbitBounds: bounds,
    // From a high corner by the door, like a teacher standing at the back.
    overview: {
      position: [-halfX * 0.62, 235, halfZ - 30],
      target: [maze.widthCm * 0.05, 10, -maze.heightCm * 0.1],
    },
    fov: 55,
    exposure: 0.9,
    pickables: [floor],
    setCutaway(on) {
      overhead.visible = !on;
      ceiling.visible = !on;
    },
    update() {},
    dispose() {
      envMap.dispose();
      pmrem.dispose();
      scene.background = null;
    },
  };
}
