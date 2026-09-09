import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createViewSelector } from '../../src/view-selector';

test('dropdown shows only the current choice and opens a vertical menu of three choices', () => {
  const dom = new JSDOM('<main></main>');
  Object.assign(globalThis, { document: dom.window.document });
  const control = createViewSelector('orbit', view => control.update(view));
  document.body.append(control.element);
  try {
    const trigger = control.element.querySelector<HTMLButtonElement>('[aria-haspopup]')!;
    const menu = control.element.querySelector<HTMLElement>('[role="menu"]')!;
    const choices = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    expect(trigger.textContent).toBe('Orbit');
    expect(menu.hidden).toBe(true);
    trigger.click();
    expect(menu.hidden).toBe(false);
    expect(choices.map(button => button.textContent)).toEqual(['Orbit', 'Arc', 'List']);
    choices[1].click();
    expect(trigger.textContent).toBe('Arc');
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(choices[1].getAttribute('aria-checked')).toBe('true');
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(choices[1]);
    choices[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(choices[2]);
    choices[2].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
    control.dispose();
    expect(control.element.isConnected).toBe(false);
  } finally { control.dispose(); dom.window.close(); }
});
