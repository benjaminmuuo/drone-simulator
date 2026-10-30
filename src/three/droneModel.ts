/**
 * A small quadcopter roughly the size of a CoDrone EDU (~17 cm across the
 * prop guards). Built from primitives; local −z is the nose.
 */
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Object3D } from 'three';

export interface DroneModel {
  readonly root: Group;
  /** Advances propeller rotation; `speed` 0 = stopped, 1 = full hover RPM. */
  spinProps(speed: number, dtSeconds: number): void;
}

const ARM = 5.4; // centre → motor, cm
const PROP_R = 2.9;

function shadowed<T extends Object3D>(object: T): T {
  object.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return object;
}

export function createDroneModel(): DroneModel {
  const root = new Group();
  root.name = 'drone';

  const shell = new MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35, metalness: 0.05 });
  const dark = new MeshStandardMaterial({ color: '#22262c', roughness: 0.6 });
  const accent = new MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.4 });
  const guardMat = new MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5 });
  const bladeMat = new MeshStandardMaterial({ color: '#111418', roughness: 0.4, side: DoubleSide });
  const blurMat = new MeshStandardMaterial({ color: '#1a1d22', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });

  // Body: rounded shell, blue top cover, battery underneath.
  const body = new Mesh(new BoxGeometry(5.4, 1.8, 7.6), shell);
  body.position.y = 0.9;
  const cover = new Mesh(new SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), accent);
  cover.scale.set(1, 0.45, 1.35);
  cover.position.y = 1.8;
  const battery = new Mesh(new BoxGeometry(3.4, 1.1, 5.6), dark);
  battery.position.y = -0.4;
  root.add(body, cover, battery);

  // Nose marker and navigation LEDs (red front, green rear) so heading is obvious.
  const ledFront = new MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2a1f', emissiveIntensity: 2.5 });
  const ledRear = new MeshStandardMaterial({ color: '#34c759', emissive: '#2bd14f', emissiveIntensity: 2 });
  const nose = new Mesh(new CylinderGeometry(0, 1.1, 2.2, 3), ledFront);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 2.1, -3.1);
  const rear = new Mesh(new SphereGeometry(0.45, 10, 8), ledRear);
  rear.position.set(0, 1.2, 3.9);
  root.add(nose, rear);

  const props: Group[] = [];
  const blurs: Mesh[] = [];
  const corners: Array<[number, number, 1 | -1]> = [
    [-1, -1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [1, 1, 1],
  ];

  for (const [sx, sz, spin] of corners) {
    const mx = (sx * ARM) / Math.SQRT2;
    const mz = (sz * ARM) / Math.SQRT2;

    const arm = new Mesh(new BoxGeometry(0.9, 0.7, ARM), dark);
    arm.position.set(mx / 2, 0.9, mz / 2);
    arm.rotation.y = Math.atan2(mx, mz);
    root.add(arm);

    const motor = new Mesh(new CylinderGeometry(0.9, 1, 1.5, 16), dark);
    motor.position.set(mx, 1.4, mz);
    const skid = new Mesh(new CylinderGeometry(0.25, 0.35, 1.8, 6), dark);
    skid.position.set(mx, -0.2, mz);
    root.add(motor, skid);

    const guard = new Mesh(new TorusGeometry(PROP_R + 0.45, 0.28, 8, 36), guardMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(mx, 2.0, mz);
    root.add(guard);

    const prop = new Group();
    prop.position.set(mx, 2.25, mz);
    prop.userData.spin = spin;
    const blade = new Mesh(new BoxGeometry(PROP_R * 2, 0.12, 0.65), bladeMat);
    blade.rotation.x = 0.12 * spin; // a little pitch on the blades
    const hub = new Mesh(new CylinderGeometry(0.35, 0.35, 0.4, 10), accent);
    prop.add(blade, hub);
    props.push(prop);

    const blur = new Mesh(new CircleGeometry(PROP_R, 32), blurMat.clone());
    blur.rotation.x = -Math.PI / 2;
    blur.position.set(mx, 2.27, mz);
    blurs.push(blur);
    root.add(prop, blur);
  }

  shadowed(root);
  blurs.forEach((b) => (b.castShadow = false));

  const MAX_RAD_PER_S = 45; // visually readable, not true RPM
  return {
    root,
    spinProps(speed, dt) {
      const s = Math.max(0, Math.min(1, speed));
      for (const prop of props) prop.rotation.y += (prop.userData.spin as number) * s * MAX_RAD_PER_S * dt;
      for (const blur of blurs) {
        (blur.material as MeshStandardMaterial).opacity = 0.28 * s;
        blur.visible = s > 0.05;
      }
    },
  };
}
