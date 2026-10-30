/**
 * Procedural canvas textures, so the 3D world needs no image assets.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import type { MazeDefinition } from '../mazes/types';
import type { ThemeId } from './themeOptions';
import { seededRandom } from './coords';

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** Meadow grass: many short blades in varied greens. */
export function grassTexture(): Texture {
  const [c, ctx] = canvas(512, 512);
  const rand = seededRandom(7);
  ctx.fillStyle = '#4c7330';
  ctx.fillRect(0, 0, 512, 512);
  // Soft patches of lighter/darker ground.
  for (let i = 0; i < 40; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 30 + rand() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() > 0.5 ? '90,130,55' : '55,85,35';
    g.addColorStop(0, `rgba(${tone},0.35)`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 14000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const len = 3 + rand() * 6;
    const lean = (rand() - 0.5) * 3;
    const light = 30 + rand() * 30;
    ctx.strokeStyle = `hsla(${85 + rand() * 25}, ${35 + rand() * 25}%, ${light}%, 0.8)`;
    ctx.lineWidth = 0.6 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - len);
    ctx.stroke();
  }
  return toTexture(c, true);
}

/** Floor tape stripe, drawn as a slightly rough strip. */
function tapeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function tapeRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, width: number, color: string) {
  const i = width / 2;
  tapeLine(ctx, x, y + i, x + w, y + i, width, color);
  tapeLine(ctx, x, y + h - i, x + w, y + h - i, width, color);
  tapeLine(ctx, x + i, y, x + i, y + h, width, color);
  tapeLine(ctx, x + w - i, y, x + w - i, y + h, width, color);
}

/** Hazard tape: alternating stripes along a rectangle's edge. */
function hazardTapeRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, width: number, a: string, b: string) {
  tapeRect(ctx, x, y, w, h, width, a);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.rect(x + width, y + width, w - width * 2, h - width * 2);
  ctx.clip('evenodd');
  ctx.strokeStyle = b;
  ctx.lineWidth = width * 0.8;
  for (let d = -h; d < w + h; d += width * 2.2) {
    ctx.beginPath();
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** "0,0" label in the arena corner that all measurements start from. */
function originMarker(ctx: CanvasRenderingContext2D, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = 'bold 9px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('0,0', 8, 8);
  ctx.restore();
}

/**
 * The arena floor markings, drawn straight from the maze data. Forest: mown
 * turf with painted lines. Classroom: floor tape on a transparent layer laid
 * over the room's floor.
 */
export function arenaTexture(maze: MazeDefinition, showGrid: boolean, theme: ThemeId): Texture {
  const scale = Math.min(4, 4096 / Math.max(maze.widthCm, maze.heightCm));
  const [c, ctx] = canvas(Math.round(maze.widthCm * scale), Math.round(maze.heightCm * scale));
  ctx.scale(scale, scale);
  const classroom = theme === 'classroom';

  if (!classroom) {
    // Mown stripes.
    const stripe = 50;
    for (let x = 0; x < maze.widthCm; x += stripe) {
      ctx.fillStyle = (x / stripe) % 2 === 0 ? '#6c9a45' : '#76a54d';
      ctx.fillRect(x, 0, stripe, maze.heightCm);
    }
    // Fine turf noise.
    const rand = seededRandom(11);
    for (let i = 0; i < maze.widthCm * maze.heightCm * 0.25; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,40,0'},${0.04 + rand() * 0.05})`;
      ctx.fillRect(rand() * maze.widthCm, rand() * maze.heightCm, 0.8, 0.8);
    }
  }

  if (showGrid) {
    ctx.strokeStyle = classroom ? 'rgba(40,70,140,0.22)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.6;
    for (let x = maze.gridSpacingCm; x < maze.widthCm; x += maze.gridSpacingCm) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, maze.heightCm);
      ctx.stroke();
    }
    for (let y = maze.gridSpacingCm; y < maze.heightCm; y += maze.gridSpacingCm) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(maze.widthCm, y);
      ctx.stroke();
    }
  }

  // No-fly zones.
  for (const zone of maze.noFlyZones) {
    if (classroom) {
      ctx.fillStyle = 'rgba(220,38,38,0.12)';
      ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
      hazardTapeRect(ctx, zone.x, zone.y, zone.width, zone.height, 5, '#e11d2a', '#f8f8f4');
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(zone.x, zone.y, zone.width, zone.height);
    ctx.clip();
    ctx.fillStyle = 'rgba(200,30,30,0.55)';
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    for (let d = -zone.height; d < zone.width; d += 12) {
      ctx.beginPath();
      ctx.moveTo(zone.x + d, zone.y + zone.height);
      ctx.lineTo(zone.x + d + zone.height, zone.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#c62828';
    ctx.lineWidth = 2;
    ctx.strokeRect(zone.x + 1, zone.y + 1, zone.width - 2, zone.height - 2);
  }

  // Landing pad.
  const lz = maze.landingZone;
  const cx = lz.x + lz.width / 2;
  const cy = lz.y + lz.height / 2;
  const r = Math.min(lz.width, lz.height) / 2;
  const hw = r * 0.5;
  const hh = r * 0.6;
  const bar = r * 0.14;
  if (classroom) {
    ctx.fillStyle = 'rgba(34,197,94,0.14)';
    ctx.fillRect(lz.x, lz.y, lz.width, lz.height);
    tapeRect(ctx, lz.x, lz.y, lz.width, lz.height, 5, '#16a34a');
    ctx.fillStyle = '#16a34a';
  } else {
    ctx.fillStyle = '#3b3f45';
    ctx.fillRect(lz.x, lz.y, lz.width, lz.height);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
  }
  ctx.fillRect(cx - hw, cy - hh, bar, hh * 2);
  ctx.fillRect(cx + hw - bar, cy - hh, bar, hh * 2);
  ctx.fillRect(cx - hw, cy - bar / 2, hw * 2, bar);

  // Start mark.
  if (classroom) {
    const s = maze.droneRadiusCm + 6;
    tapeLine(ctx, maze.start.x - s, maze.start.y, maze.start.x + s, maze.start.y, 4, '#2563eb');
    tapeLine(ctx, maze.start.x, maze.start.y - s, maze.start.x, maze.start.y + s, 4, '#2563eb');
  } else {
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(maze.start.x, maze.start.y, maze.droneRadiusCm + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Checkpoints: a taped circle around the cone (classroom).
  if (classroom) {
    for (const cp of maze.checkpoints) {
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, cp.radiusCm, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Boundary.
  if (classroom) {
    hazardTapeRect(ctx, 0, 0, maze.widthCm, maze.heightCm, 5, '#facc15', '#1f2937');
  } else {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, maze.widthCm - 3, maze.heightCm - 3);
  }
  originMarker(ctx, classroom ? '#1f2937' : '#ffffff');

  const texture = toTexture(c);
  texture.anisotropy = 8;
  return texture;
}

/** Corrugated cardboard with a packing-tape strip and printed handling marks. */
export function cardboardTexture(seed: number): Texture {
  const [c, ctx] = canvas(256, 256);
  const rand = seededRandom(seed);
  ctx.fillStyle = `hsl(${30 + rand() * 4}, ${42 + rand() * 8}%, ${55 + rand() * 6}%)`;
  ctx.fillRect(0, 0, 256, 256);
  // Fibres and scuffs.
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,235,200' : '90,55,20'},${0.05 + rand() * 0.08})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 3, 0.6 + rand());
  }
  // Faint corrugation.
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = 'rgba(80,50,20,0.05)';
    ctx.fillRect(x, 0, 1.5, 256);
  }
  // Edge darkening, like worn box edges.
  const edge = ctx.createLinearGradient(0, 0, 0, 256);
  edge.addColorStop(0, 'rgba(70,40,15,0.25)');
  edge.addColorStop(0.06, 'rgba(70,40,15,0)');
  edge.addColorStop(0.94, 'rgba(70,40,15,0)');
  edge.addColorStop(1, 'rgba(70,40,15,0.25)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 256, 256);
  // Brown packing tape across the middle.
  ctx.fillStyle = 'rgba(150,95,40,0.55)';
  ctx.fillRect(0, 112, 256, 32);
  ctx.fillStyle = 'rgba(255,240,210,0.18)';
  ctx.fillRect(0, 116, 256, 3);
  // "This way up" arrows on some boxes.
  if (rand() > 0.4) {
    ctx.strokeStyle = 'rgba(40,30,25,0.55)';
    ctx.fillStyle = 'rgba(40,30,25,0.55)';
    ctx.lineWidth = 4;
    for (const x of [40, 64]) {
      ctx.beginPath();
      ctx.moveTo(x, 220);
      ctx.lineTo(x, 175);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 9, 180);
      ctx.lineTo(x, 166);
      ctx.lineTo(x + 9, 180);
      ctx.fill();
    }
  }
  return toTexture(c);
}

/** Traffic-cone orange with two reflective white bands (v runs up the cone). */
export function coneTexture(): Texture {
  const [c, ctx] = canvas(8, 128);
  ctx.fillStyle = '#ff6a13';
  ctx.fillRect(0, 0, 8, 128);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 26, 8, 16);
  ctx.fillRect(0, 58, 8, 14);
  return toTexture(c);
}

/** Classroom vinyl floor: 30 cm speckled tiles (one tile per texture repeat). */
export function floorTileTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const rand = seededRandom(21);
  ctx.fillStyle = '#d9d4c7';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.6 ? 'rgba(120,110,95,0.35)' : v > 0.3 ? 'rgba(250,248,240,0.5)' : 'rgba(160,150,130,0.3)';
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
  ctx.strokeStyle = 'rgba(120,112,100,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  return toTexture(c, true);
}

/** Lightly textured painted wall. */
export function wallPaintTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const rand = seededRandom(31);
  ctx.fillStyle = '#ece6d8';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '150,140,120'},${0.04 + rand() * 0.05})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5);
  }
  return toTexture(c, true);
}

/** Wooden crate planks with grain. */
export function woodTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const rand = seededRandom(3);
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const x = (i * 256) / planks;
    ctx.fillStyle = `hsl(${28 + rand() * 8}, ${45 + rand() * 10}%, ${42 + rand() * 10}%)`;
    ctx.fillRect(x, 0, 256 / planks, 256);
    for (let g = 0; g < 18; g++) {
      ctx.strokeStyle = `rgba(60,30,10,${0.08 + rand() * 0.12})`;
      ctx.lineWidth = 0.5 + rand();
      const gx = x + rand() * (256 / planks);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + rand() * 6 - 3, 80, gx + rand() * 6 - 3, 170, gx + rand() * 4 - 2, 256);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,20,5,0.55)';
    ctx.fillRect(x, 0, 2, 256);
  }
  // Cross braces.
  ctx.fillStyle = 'rgba(70,40,15,0.35)';
  ctx.fillRect(0, 10, 256, 14);
  ctx.fillRect(0, 232, 256, 14);
  return toTexture(c, true);
}

/** Weathered concrete for walls and pillars. */
export function concreteTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const rand = seededRandom(5);
  ctx.fillStyle = '#9a9a94';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + rand() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v - 5},${0.15 + rand() * 0.2})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Formwork seams and stains.
  ctx.fillStyle = 'rgba(60,60,55,0.25)';
  ctx.fillRect(0, 127, 256, 2);
  for (let i = 0; i < 6; i++) {
    const x = rand() * 256;
    const g = ctx.createLinearGradient(x, 0, x, 256);
    g.addColorStop(0, 'rgba(70,65,55,0)');
    g.addColorStop(1, 'rgba(70,65,55,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 6 + rand() * 10, 256);
  }
  return toTexture(c, true);
}

/** Safety netting: dark mesh on a transparent background. */
export function netTexture(): Texture {
  const [c, ctx] = canvas(64, 64);
  ctx.strokeStyle = 'rgba(30,30,30,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 64, 64);
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 64);
  ctx.moveTo(0, 32);
  ctx.lineTo(64, 32);
  ctx.stroke();
  return toTexture(c, true);
}
