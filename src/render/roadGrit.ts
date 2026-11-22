/** Tileable procedural road grit shared by all city drawing modes. */
/** A small tileable grit pattern used to break up the roadway. */
export function makeGritTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = '#45474e';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? `rgba(150,150,148,${0.05 + rnd() * 0.14})` : `rgba(14,14,16,${0.05 + rnd() * 0.2})`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 12 + rnd() * 44;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rnd() > 0.5 ? '180,178,172' : '10,10,12'},0.09)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}
