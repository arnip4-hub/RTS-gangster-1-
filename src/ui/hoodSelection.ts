/** Selection rules used by the eight-slot Hoods bar (and its regression tests). */
export const HOOD_SLOTS = 8;

export function hoodPage<T>(items: readonly T[], page: number): {
  page: number; pageCount: number; slots: (T | null)[];
} {
  const pageCount = Math.max(1, Math.ceil(items.length / HOOD_SLOTS));
  const validPage = Math.max(0, Math.min(pageCount - 1, Math.floor(page) || 0));
  return {
    page: validPage, pageCount,
    slots: Array.from({ length: HOOD_SLOTS }, (_, index) => items[validPage * HOOD_SLOTS + index] ?? null),
  };
}

export function updateHoodSelection(
  current: readonly number[],
  clickedId: number,
  shownIds: readonly number[],
  anchorId: number | null,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): number[] {
  const multiple = !!(modifiers.ctrlKey || modifiers.metaKey);
  if (modifiers.shiftKey && anchorId != null) {
    const a = shownIds.indexOf(anchorId), b = shownIds.indexOf(clickedId);
    if (a >= 0 && b >= 0) {
      const range = shownIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      return multiple ? [...new Set([...current, ...range])] : [...range];
    }
  }
  if (multiple)
    return current.includes(clickedId) ? current.filter(id => id !== clickedId) : [...current, clickedId];
  return [clickedId];
}
