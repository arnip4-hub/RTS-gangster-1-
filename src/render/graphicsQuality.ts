/** City drawing quality. This setting does not change the simulation. */
export type GraphicsQuality = 'full' | 'light';

const KEY = 'og.graphicsQuality';

export function readGraphicsQuality(): GraphicsQuality {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'full'; } catch { return 'full'; }
}

export function writeGraphicsQuality(quality: GraphicsQuality): void {
  try { localStorage.setItem(KEY, quality); } catch { /* session only */ }
}

export function graphicsPixelRatio(devicePixelRatio: number, quality: GraphicsQuality): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, quality === 'light' ? 1 : 2);
}

export const LIGHT_DETAILED_STREET_CHARACTERS = 8;
