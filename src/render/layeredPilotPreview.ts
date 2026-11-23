const KEY = 'og.layeredPilot1930s';

/** An explicit URL flag is handy for browser reviews; the option makes Windows
 * preview builds testable without editing Electron's file URL. No save data. */
export function readLayeredPilotPreview(search = ''): boolean {
  const forced = new URLSearchParams(search).get('layeredPeople');
  if (forced === '1') return true;
  if (forced === '0') return false;
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function writeLayeredPilotPreview(enabled: boolean): void {
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* session only */ }
}
