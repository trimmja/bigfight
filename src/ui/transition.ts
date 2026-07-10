import { PISTOL_SVG } from '../screens/TitleScreen';

/**
 * Signature online 'pistol wipe': two navy panels (tilted ±12°) slam shut
 * over the screen, the cartoon pistol pops center with a star flash, then the
 * panels part. `onCovered` fires at full cover — swap screens there so the
 * new screen is revealed as the panels open. Transform/opacity-only.
 */

const SLAM_MS = 240;
const HOLD_MS = 210;
const PART_MS = 300;

let active = false;

export function wipe(onCovered: () => void): void {
  // Never stack wipes — run the swap immediately if one is mid-flight.
  if (active) {
    onCovered();
    return;
  }
  active = true;

  const overlay = document.createElement('div');
  overlay.className = 'bf-wipe';
  const left = document.createElement('div');
  left.className = 'bf-wipe-panel bf-wipe-left';
  const right = document.createElement('div');
  right.className = 'bf-wipe-panel bf-wipe-right';
  const badge = document.createElement('div');
  badge.className = 'bf-wipe-badge';
  badge.innerHTML = `<div class="bf-wipe-star"></div>${PISTOL_SVG}`;
  overlay.append(left, right, badge);
  document.body.appendChild(overlay);

  const finish = (): void => {
    overlay.remove();
    active = false;
  };

  setTimeout(() => {
    try {
      onCovered();
    } finally {
      setTimeout(() => {
        overlay.classList.add('bf-wipe-open');
        setTimeout(finish, PART_MS + 60);
      }, HOLD_MS);
    }
  }, SLAM_MS);

  // Safety net: a hidden tab throttles timers; never leave the cover stuck.
  setTimeout(() => {
    if (overlay.isConnected) finish();
  }, SLAM_MS + HOLD_MS + PART_MS + 1500);
}
