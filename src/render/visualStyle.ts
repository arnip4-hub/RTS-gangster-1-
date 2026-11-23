/** City artwork, independent of graphics performance settings. */
export type VisualStyle = 'detailed' | 'illustrated' | 'illustrated3d';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'illustrated') return 'illustrated';
    if (saved === 'illustrated3d') return 'illustrated3d';
    return 'detailed';
  }
  catch { return 'detailed'; }
}

export function usesPaintedCity(style: VisualStyle): boolean {
  return style === 'illustrated' || style === 'illustrated3d';
}

export function writeVisualStyle(style: VisualStyle): void {
  try { localStorage.setItem(KEY, style); } catch { /* session only */ }
}
