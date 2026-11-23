/** City artwork, independent of graphics performance settings. */
export type VisualStyle = 'detailed' | 'illustrated3d';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'illustrated3d') return 'illustrated3d';
    // Legacy billboard mode is retired. A saved 'illustrated' preference
    // opens the pure 3D city rather than a missing sprite layer.
    if (saved === 'illustrated') return 'detailed';
    if (saved === 'detailed') return 'detailed';
    return 'detailed';
  }
  catch { return 'detailed'; }
}

export function usesPaintedCity(style: VisualStyle): boolean {
  return style === 'illustrated3d';
}

export function writeVisualStyle(style: VisualStyle): void {
  try { localStorage.setItem(KEY, style); } catch { /* session only */ }
}
