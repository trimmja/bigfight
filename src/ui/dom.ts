/** Tiny DOM builders for game UI (all screens use these). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  className = 'bf-button',
  parent?: HTMLElement,
): HTMLButtonElement {
  const node = el('button', className, parent);
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  return node;
}

/** Root panel mounted under #ui. Remember to .remove() it on screen exit. */
export function uiRoot(className: string): HTMLElement {
  const root = el('div', className);
  document.getElementById('ui')?.appendChild(root);
  return root;
}
