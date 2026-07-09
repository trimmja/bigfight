/**
 * In-app update check: compares the baked-in build id against the freshly
 * fetched version.json on the server. Lets home-screen players update with
 * one tap instead of force-quitting (save data lives in localStorage and is
 * untouched by a reload).
 */
export async function updateAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { buildId?: string };
    return typeof data.buildId === 'string' && data.buildId !== __BUILD_ID__;
  } catch {
    return false; // offline or dev server — never nag
  }
}

export function applyUpdate(): void {
  location.reload();
}
