import { expect, test } from 'bun:test';
import { easeCamera } from '../../src/navigation';

test('camera easing follows the same trajectory at different refresh rates', () => {
  const advance = (steps: number) => {
    let y = 10;
    for (let i = 0; i < steps; i++) y = easeCamera(y, -20, 500 / steps, 130);
    return y;
  };
  expect(advance(30)).toBeCloseTo(advance(60), 10);
  expect(advance(30)).toBeCloseTo(advance(72), 10);
});

test('camera settles exactly at rail ends and never overshoots', () => {
  let y = 10;
  for (let i = 0; i < 180; i++) {
    y = easeCamera(y, -20, 1000 / 60, 130);
    expect(y).toBeGreaterThanOrEqual(-20);
    expect(y).toBeLessThan(10);
  }
  expect(y).toBe(-20);
  expect(easeCamera(10, -20, 0, 130)).toBe(10);
});
