/** City artwork, independent of graphics performance settings. */
export type VisualStyle = 'detailed' | 'illustrated';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try { return localStorage.getItem(KEY) === 'illustrated' ? 'illustrated' : 'detailed'; }
  catch { return 'detailed'; }
}

export function writeVisualStyle(style: VisualStyle): void {
  try { localStorage.setItem(KEY, style); } catch { /* session only */ }
}
