import { icebergViews, type IcebergView } from './view.js';

let selectorId = 0;

/** Compact disclosure with a keyboard-accessible, single-choice menu. */
export function createViewSelector(view: IcebergView, onSelect: (view: IcebergView) => void) {
  const element = document.createElement('div');
  element.className = 'iceberg-viewer__view-selector';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'iceberg-viewer__view-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'iceberg-viewer__view-menu';
  menu.id = `iceberg-view-menu-${++selectorId}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Iceberg view');
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  const names = { orbit: 'Orbit', arc: 'Arc', list: 'List' };
  const buttons = icebergViews.map(mode => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = names[mode];
    button.setAttribute('role', 'menuitemradio');
    button.tabIndex = -1;
    button.addEventListener('click', () => {
      onSelect(mode);
      close(true);
    });
    menu.append(button);
    return button;
  });
  function update(next: IcebergView) {
    view = next;
    trigger.textContent = names[view];
    trigger.setAttribute('aria-label', `View: ${names[view]}`);
    buttons.forEach((button, index) => button.setAttribute('aria-checked', String(icebergViews[index] === view)));
  }
  function close(focus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({ preventScroll: true });
  }
  function open() {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    buttons[icebergViews.indexOf(view)].focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
  });
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.key === 'Tab' && !menu.hidden) close(true);
  });
  menu.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
      : event.key === 'ArrowDown' ? (index + 1) % 3
      : event.key === 'ArrowUp' ? (index + 2) % 3 : null;
    if (next !== null) { event.preventDefault(); buttons[next].focus({ preventScroll: true }); }
  });
  function onOutside(event: Event) {
    if (!element.contains(event.target as Node)) close();
  }
  element.addEventListener('focusout', event => {
    if (!element.contains(event.relatedTarget as Node)) close();
  });
  document.addEventListener('pointerdown', onOutside);
  element.append(trigger, menu);
  update(view);
  return { element, update, dispose() { document.removeEventListener('pointerdown', onOutside); element.remove(); } };
}
