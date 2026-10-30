/**
 * Outdoor surroundings: physically based sky with drifting clouds, sun with
 * soft shadows, sky-lit reflections, a meadow, trees, rocks and distant hills.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { WebGLRenderer } from 'three';
import type { MazeDefinition } from '../mazes/types';
import { Sky } from 'three/addons/objects/Sky.js';
import { seededRandom } from './coords';
import { arenaBounds } from './cameraView';
import type { Scenery } from './scenery';
import { grassTexture } from './textures';

const SUN_ELEVATION_DEG = 42;
const SUN_AZIMUTH_DEG = 145;

/** Gap kept between the follow camera and the safety net. */
const NET_CLEARANCE_CM = 10;

export function createForest(scene: Scene, renderer: WebGLRenderer, maze: MazeDefinition): Scenery {
  const arenaSpanCm = Math.max(maze.widthCm, maze.heightCm);
  const sunDir = new Vector3().setFromSphericalCoords(
    1,
    MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
    MathUtils.degToRad(SUN_AZIMUTH_DEG),
  );

  // Sky dome with built-in volumetric-looking clouds.
  const sky = new Sky();
  sky.scale.setScalar(60_000);
  const u = sky.material.uniforms;
  u['turbidity']!.value = 4;
  u['rayleigh']!.value = 1.4;
  u['mieCoefficient']!.value = 0.004;
  u['mieDirectionalG']!.value = 0.85;
  u['cloudCoverage']!.value = 0.35;
  u['cloudDensity']!.value = 0.5;
  u['sunPosition']!.value.copy(sunDir);

  // Image-based lighting from the sky, so materials pick up blue sky and warm sun.
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.add(sky);
  const envMap = pmrem.fromScene(envScene, 0, 1, 100_000).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.55;
  scene.add(sky);
  scene.fog = new Fog(new Color('#c9d9e6'), 2_500, 22_000);

  const sun = new DirectionalLight('#fff1dc', 3.2);
  sun.position.copy(sunDir).multiplyScalar(1_200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const half = arenaSpanCm / 2 + 220;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 3_000 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.add(new HemisphereLight('#cfe3ff', '#56683a', 0.45));

  // Meadow.
  const grass = grassTexture();
  const groundSize = 40_000;
  grass.repeat.set(groundSize / 140, groundSize / 140);
  grass.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new Mesh(
    new PlaneGeometry(groundSize, groundSize),
    new MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addTrees(scene, arenaSpanCm);
  addRocks(scene, arenaSpanCm);
  addHills(scene);

  const span = arenaSpanCm;
  return {
    // Inside the safety net, so the netting never blocks the view.
    followBounds: arenaBounds(maze, NET_CLEARANCE_CM),
    orbitBounds: null,
    // Low enough to see the horizon and sky, high enough to see over the walls.
    overview: {
      position: [-span * 0.32, span * 0.5, maze.heightCm / 2 + span * 0.82],
      target: [0, 30, -maze.heightCm * 0.08],
    },
    fov: 45,
    exposure: 0.62,
    pickables: [ground],
    setCutaway() {},
    update(t) {
      u['time']!.value = t;
    },
    dispose() {
      envMap.dispose();
      pmrem.dispose();
    },
  };
}

function placeRing(rand: () => number, minR: number, maxR: number): [number, number] {
  const angle = rand() * Math.PI * 2;
  const r = minR + Math.sqrt(rand()) * (maxR - minR);
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

function addTrees(scene: Scene, arenaSpanCm: number) {
  const rand = seededRandom(42);
  const minR = arenaSpanCm / 2 + 450;
  const maxR = 6_500;
  const conifers = 110;
  const broadleaf = 90;

  const trunkGeo = new CylinderGeometry(0.6, 1, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = new MeshStandardMaterial({ color: '#5a4030', roughness: 0.95 });
  const pineGeo = new ConeGeometry(1, 1, 8);
  pineGeo.translate(0, 0.5, 0);
  const leafGeo = new IcosahedronGeometry(1, 1);
  const foliageMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });

  const trunks = new InstancedMesh(trunkGeo, trunkMat, conifers + broadleaf);
  const pines = new InstancedMesh(pineGeo, foliageMat, conifers * 2);
  const crowns = new InstancedMesh(leafGeo, foliageMat, broadleaf * 2);
  const m = new Matrix4();
  const q = new Quaternion();
  const color = new Color();

  let trunkIndex = 0;
  for (let i = 0; i < conifers; i++) {
    const [x, z] = placeRing(rand, minR, maxR);
    const h = 450 + rand() * 650;
    const w = h * (0.22 + rand() * 0.06);
    m.compose(new Vector3(x, 0, z), q, new Vector3(w * 0.12, h * 0.3, w * 0.12));
    trunks.setMatrixAt(trunkIndex++, m);
    for (let tier = 0; tier < 2; tier++) {
      const tierW = w * (1 - tier * 0.3);
      m.compose(new Vector3(x, h * (0.18 + tier * 0.3), z), q, new Vector3(tierW, h * (0.65 - tier * 0.12), tierW));
      pines.setMatrixAt(i * 2 + tier, m);
      pines.setColorAt(i * 2 + tier, color.setHSL(0.31 + rand() * 0.05, 0.45, 0.17 + rand() * 0.07));
    }
  }
  for (let i = 0; i < broadleaf; i++) {
    const [x, z] = placeRing(rand, minR, maxR);
    const h = 350 + rand() * 450;
    const r = h * (0.3 + rand() * 0.1);
    m.compose(new Vector3(x, 0, z), q, new Vector3(r * 0.09, h * 0.55, r * 0.09));
    trunks.setMatrixAt(trunkIndex++, m);
    for (let blob = 0; blob < 2; blob++) {
      const ox = (rand() - 0.5) * r * 0.6;
      const oz = (rand() - 0.5) * r * 0.6;
      const s = r * (0.75 + rand() * 0.3);
      m.compose(new Vector3(x + ox, h * 0.62 + blob * r * 0.35, z + oz), q, new Vector3(s, s * 0.85, s));
      crowns.setMatrixAt(i * 2 + blob, m);
      crowns.setColorAt(i * 2 + blob, color.setHSL(0.22 + rand() * 0.08, 0.5, 0.22 + rand() * 0.1));
    }
  }

  for (const mesh of [trunks, pines, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
}

function addRocks(scene: Scene, arenaSpanCm: number) {
  const rand = seededRandom(99);
  const count = 40;
  const rocks = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }),
    count,
  );
  const m = new Matrix4();
  const color = new Color();
  for (let i = 0; i < count; i++) {
    const [x, z] = placeRing(rand, arenaSpanCm / 2 + 180, 3_500);
    const s = 8 + rand() * 35;
    const q = new Quaternion().setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * Math.PI);
    m.compose(new Vector3(x, s * 0.25, z), q, new Vector3(s, s * (0.5 + rand() * 0.3), s * (0.8 + rand() * 0.4)));
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, color.setHSL(0.1, 0.05, 0.38 + rand() * 0.15));
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
}

function addHills(scene: Scene) {
  const rand = seededRandom(1234);
  const material = new MeshStandardMaterial({ color: '#4d6b3c', roughness: 1, flatShading: true });
  const geometry = new SphereGeometry(1, 18, 10);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + rand() * 0.4;
    const dist = 13_000 + rand() * 5_000;
    const hill = new Mesh(geometry, material);
    hill.position.set(Math.cos(angle) * dist, -400, Math.sin(angle) * dist);
    hill.scale.set(4_000 + rand() * 4_000, 900 + rand() * 1_200, 3_500 + rand() * 3_000);
    scene.add(hill);
  }
}
