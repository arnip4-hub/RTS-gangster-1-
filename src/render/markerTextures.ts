import * as THREE from 'three';

/** Small reusable markers for live-order and arrest visualization. */
/** A small card painted on a canvas: cream disc, dark glyph. */
export function markerTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#efe4c8';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1f14';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#2a1f14';
  ctx.strokeStyle = '#2a1f14';
  draw(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A raised palm: wait for the word. */
export function drawHand(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // Fingers.
  for (const [x, top] of [[22, 20], [28, 15], [34, 14], [40, 19]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x, top);
    ctx.stroke();
  }
  // Thumb and palm.
  ctx.beginPath();
  ctx.moveTo(19, 38);
  ctx.lineTo(14, 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(19, 34);
  ctx.lineTo(43, 34);
  ctx.lineTo(43, 44);
  ctx.quadraticCurveTo(31, 52, 19, 44);
  ctx.closePath();
  ctx.fill();
}

/** Prison bars: an arrest. */
export function drawBars(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 4;
  for (const x of [20, 28, 36, 44]) {
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x, 48);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(16, 16);
  ctx.lineTo(48, 16);
  ctx.moveTo(16, 48);
  ctx.lineTo(48, 48);
  ctx.stroke();
}


