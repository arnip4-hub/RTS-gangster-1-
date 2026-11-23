/** City artwork, independent of graphics performance settings.
 * One unified 3D style remains: the painted 1930s city with full wardrobe. */
export type VisualStyle = 'illustrated3d';

const KEY = 'og.visualStyle';

export function readVisualStyle(): VisualStyle {
  try {
    const saved = localStorage.getItem(KEY);
    // Migrate any legacy preference (detailed, illustrated billboard, or missing)
    // onto the single remaining painted 3D city.
    if (saved !== 'illustrated3d') {
      try { localStorage.setItem(KEY, 'illustrated3d'); } catch { /* session only */ }
    }
    return 'illustrated3d';
  }
  catch { return 'illustrated3d'; }
}

export function usesPaintedCity(_style?: VisualStyle): boolean {
  return true;
}

export function writeVisualStyle(_style: VisualStyle): void {
  try { localStorage.setItem(KEY, 'illustrated3d'); } catch { /* session only */ }
}
