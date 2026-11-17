/** City artwork, independent of graphics performance settings. */
export type VisualStyle = 'detailed' | 'illustrated' | 'illustrated3d';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'illustrated') return 'illustrated';
    // The animated illustrated 3D wardrobe caused severe mesh stretching. Old
    // saves are moved back to the stable modelled city automatically.
    if (saved === 'illustrated3d') localStorage.setItem(KEY, 'detailed');
    return 'detailed';
  }
  catch { return 'detailed'; }
}

export function usesPaintedCity(style: VisualStyle): boolean {
  return style === 'illustrated' || style === 'illustrated3d';
}

export function writeVisualStyle(style: VisualStyle): void {
  const supported = style === 'illustrated3d' ? 'detailed' : style;
  try { localStorage.setItem(KEY, supported); } catch { /* session only */ }
}
