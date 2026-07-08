/**
 * Canvas-generated textures for the neon look. Every factory memoizes its
 * result at module scope, so a texture is drawn once and shared by all callers
 * (never disposed — they live for the whole session). No `ctx.filter` is used;
 * glow comes from `shadowBlur`, which Safari supports.
 */
import * as THREE from 'three';

/** Create an offscreen 2D canvas + context of the given size. */
function make2D(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

/** `0x00eaff` → `#00eaff`. */
function cssHex(hex: number): string {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}

/** `0x00eaff`, 0.5 → `rgba(0, 234, 255, 0.5)`. */
function cssRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Trace a rounded-rectangle sub-path (no reliance on ctx.roundRect for Safari). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function finalize(canvas: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Glow disc — the shared soft round sprite for particles/glows.
// ---------------------------------------------------------------------------

let _glowDisc: THREE.CanvasTexture | null = null;

/** 128px radial gradient, opaque white core → transparent edge. */
export function makeGlowDisc(): THREE.CanvasTexture {
  if (_glowDisc) return _glowDisc;
  const size = 128;
  const { canvas, ctx } = make2D(size);
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.28)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _glowDisc = finalize(canvas, false);
  return _glowDisc;
}

// ---------------------------------------------------------------------------
// Grid — dark tile with glowing lines, for platform tops.
// ---------------------------------------------------------------------------

const _grids = new Map<number, THREE.CanvasTexture>();

/** 512px dark tile with 1px glowing grid lines in `color`. Tiling (repeat). */
export function makeGrid(color: number): THREE.CanvasTexture {
  const cached = _grids.get(color);
  if (cached) return cached;
  const size = 512;
  const { canvas, ctx } = make2D(size);

  // Dark base with a faint vertical sheen so tops don't read as flat black.
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#0a0c18');
  bg.addColorStop(1, '#05050c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const step = 64;
  ctx.lineWidth = 1;
  ctx.shadowColor = cssHex(color);
  ctx.shadowBlur = 6;
  ctx.strokeStyle = cssRgba(color, 0.75);
  ctx.beginPath();
  for (let p = 0; p <= size; p += step) {
    ctx.moveTo(p + 0.5, 0);
    ctx.lineTo(p + 0.5, size);
    ctx.moveTo(0, p + 0.5);
    ctx.lineTo(size, p + 0.5);
  }
  ctx.stroke();

  const tex = finalize(canvas, true);
  _grids.set(color, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Noise — monochrome grain.
// ---------------------------------------------------------------------------

let _noise: THREE.CanvasTexture | null = null;

/** 256px monochrome noise (tiling). */
export function makeNoise(): THREE.CanvasTexture {
  if (_noise) return _noise;
  const size = 256;
  const { canvas, ctx } = make2D(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noise = finalize(canvas, true);
  return _noise;
}

// ---------------------------------------------------------------------------
// Scanlines — subtle horizontal CRT lines.
// ---------------------------------------------------------------------------

let _scanlines: THREE.CanvasTexture | null = null;

/** Small tiling tile of faint horizontal scanlines (mostly transparent). */
export function makeScanlines(): THREE.CanvasTexture {
  if (_scanlines) return _scanlines;
  const size = 4;
  const { canvas, ctx } = make2D(size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(0, 0, size, 1);
  _scanlines = finalize(canvas, true);
  return _scanlines;
}

// ---------------------------------------------------------------------------
// Pistol logo — the neon-sign title mark.
// ---------------------------------------------------------------------------

let _pistol: THREE.CanvasTexture | null = null;

/** Multi-pass neon-tube stroke: wide dim → bright → white-hot thin core. */
function neonStroke(ctx: CanvasRenderingContext2D, buildPath: () => void): void {
  const passes = [
    { width: 20, color: cssRgba(0x00eaff, 0.35), blur: 44, cap: 'round' as const },
    { width: 11, color: cssHex(0x00eaff), blur: 26, cap: 'round' as const },
    { width: 5, color: '#bafcff', blur: 14, cap: 'round' as const },
    { width: 2, color: '#ffffff', blur: 6, cap: 'round' as const },
  ];
  ctx.lineJoin = 'round';
  for (const p of passes) {
    ctx.lineWidth = p.width;
    ctx.strokeStyle = p.color;
    ctx.lineCap = p.cap;
    ctx.shadowColor = cssHex(0x00eaff);
    ctx.shadowBlur = p.blur;
    ctx.beginPath();
    buildPath();
    ctx.stroke();
  }
}

/**
 * 1024×512 transparent canvas: a stylized side-view pistol drawn as a glowing
 * neon-tube outline (slide/barrel, muzzle tick, frame, angled grip, trigger
 * guard, trigger). The title logo.
 */
export function makePistolLogo(): THREE.CanvasTexture {
  if (_pistol) return _pistol;
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.clearRect(0, 0, w, h);

  neonStroke(ctx, () => {
    // Slide / upper receiver.
    roundRectPath(ctx, 210, 150, 560, 66, 16);
    // Stubby barrel past the slide + muzzle tick.
    roundRectPath(ctx, 770, 166, 44, 32, 8);
    ctx.moveTo(812, 168);
    ctx.lineTo(812, 196);
    // Frame underside (dust cover) beneath the slide.
    ctx.moveTo(250, 216);
    ctx.lineTo(250, 252);
    ctx.lineTo(700, 252);
    ctx.lineTo(700, 216);
    // Angled grip.
    ctx.moveTo(300, 252);
    ctx.lineTo(334, 402);
    ctx.quadraticCurveTo(362, 414, 406, 402);
    ctx.lineTo(392, 252);
    // Trigger guard (hanging loop).
    ctx.moveTo(410, 252);
    ctx.bezierCurveTo(398, 344, 500, 348, 486, 252);
    // Trigger.
    ctx.moveTo(440, 262);
    ctx.quadraticCurveTo(430, 296, 448, 308);
  });

  ctx.shadowBlur = 0;
  _pistol = finalize(canvas, false);
  return _pistol;
}
