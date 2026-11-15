/** City artwork, independent of graphics performance settings. */
export type VisualStyle = 'detailed' | 'illustrated' | 'illustrated3d';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'illustrated' || saved === 'illustrated3d' || saved === 'detailed' ? saved : 'illustrated3d';
  }
  catch { return 'detailed'; }
}

export function usesPaintedCity(style: VisualStyle): boolean {
  return style === 'illustrated' || style === 'illustrated3d';
}

export function writeVisualStyle(style: VisualStyle): void {
  try { localStorage.setItem(KEY, style); } catch { /* session only */ }
}
