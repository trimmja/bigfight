/**
 * Kid-voice toast queue: chunky pill messages that pop in bottom-center and
 * hop away. Lives outside #ui so toasts survive screen replacement (a join
 * error toast should outlive the screen that fired it).
 */

const TOAST_SECONDS = 2.4;
const MAX_VISIBLE = 3;

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && container.isConnected) return container;
  container = document.createElement('div');
  container.className = 'bf-toasts';
  document.body.appendChild(container);
  return container;
}

/** Show a kid-voice toast, e.g. "Can't reach the arena — try again!". */
export function toast(text: string): void {
  const host = ensureContainer();
  while (host.children.length >= MAX_VISIBLE) host.firstElementChild?.remove();
  const node = document.createElement('div');
  node.className = 'bf-toast';
  node.textContent = text;
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add('bf-toast-out');
    setTimeout(() => node.remove(), 240);
  }, TOAST_SECONDS * 1000);
}
