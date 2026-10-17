// M1 táctil + M0 settings v2 + M3 tiers (tdd): la capa táctil es pura y determinista.
// Si el táctil alimenta `Input` con los mismos SimInput en Bun y en Chrome,
// la sim (determinista) da el mismo hash: cross-play PC↔móvil sin desync.
import { describe, expect, test } from 'bun:test';
import { Input } from '../src/input/input';
import { TOUCH_ITEM_CODE, applyTouchCurve, touchStateToSimInput } from '../src/input/touch';
import { initialTier } from '../src/mobile';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, parseSettings } from '../src/settings';

describe('curva táctil (deadzone 0.15 + x^1.4)', () => {
  test('dentro de la deadzone es cero', () => {
    expect(applyTouchCurve(0)).toBe(0);
    expect(applyTouchCurve(0.14)).toBe(0);
    expect(applyTouchCurve(-0.1)).toBe(0);
  });
  test('fondo da ±1 y la curva es monótona', () => {
    expect(applyTouchCurve(1)).toBeCloseTo(1, 10);
    expect(applyTouchCurve(-1)).toBeCloseTo(-1, 10);
    const a = applyTouchCurve(0.5), b = applyTouchCurve(0.8);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(applyTouchCurve(0.5)).toBe(-applyTouchCurve(-0.5));
  });
});

describe('touchStateToSimInput', () => {
  test('autoGas ON: gas a fondo sin pulsar', () => {
    const r = touchStateToSimInput({ steer: 0, gas: 0, brake: 0, drift: false }, true);
    expect(r.t).toBe(1);
    expect(r.s).toBe(0);
    expect(r.d).toBe(false);
  });
  test('el freno resta también con autoGas', () => {
    const r = touchStateToSimInput({ steer: 0.5, gas: 0, brake: 1, drift: true }, true);
    expect(r.t).toBe(0);
    expect(r.s).toBeCloseTo(0.5, 10);
    expect(r.d).toBe(true);
  });
  test('autoGas OFF respeta el gas manual', () => {
    expect(touchStateToSimInput({ steer: 0, gas: 0, brake: 0, drift: false }, false).t).toBe(0);
    expect(touchStateToSimInput({ steer: 0, gas: 1, brake: 0, drift: false }, false).t).toBe(1);
  });
  test('secuencia sintética 60 ticks: idéntica en cada pasada (hash estable)', () => {
    const seq = (run: number) => {
      const out: unknown[] = [];
      for (let i = 0; i < 60; i++) {
        const steer = applyTouchCurve(i < 30 ? -0.8 : 0.6);
        out.push(touchStateToSimInput({ steer, gas: 1, brake: 0, drift: i >= 40 }, run % 2 === 0));
      }
      return out;
    };
    expect(seq(0)).toEqual(seq(2));
    expect(seq(1)).toEqual(seq(3));
  });
});

describe('integración con Input (sin romper teclado/mando)', () => {
  test('el táctil alimenta steer/throttle/held', () => {
    const inp = new Input();
    inp.setTouchAnalog({ steer: -0.7, gas: 1, brake: 0, drift: true });
    expect(inp.steer()).toBeCloseTo(-0.7, 10);
    expect(inp.throttle()).toBe(1);
    expect(inp.held('derrapar')).toBe(true);
    expect(inp.held('izquierda')).toBe(true);
    expect(inp.held('derecha')).toBe(false);
  });
  test('el teclado sigue mandando sin táctil', () => {
    const inp = new Input();
    inp.keys.add('ArrowUp');
    expect(inp.throttle()).toBe(1);
    expect(inp.held('acelerar')).toBe(true);
  });
  test('OBJETO táctil sale como Space virtual', () => {
    const inp = new Input();
    inp.pressTouchItem();
    const q = inp.drainPressed();
    expect(q).toContain(TOUCH_ITEM_CODE);
    expect(inp.is(TOUCH_ITEM_CODE, 'objeto')).toBe(true);
    expect(inp.is('Space', 'objeto')).toBe(true);
    // se consume una sola vez (flanco)
    expect(inp.drainPressed()).not.toContain(TOUCH_ITEM_CODE);
  });
});

describe('settings v1→v2 (save-systems)', () => {
  test('migra flags táctiles y calidad con valores por defecto', () => {
    const v1 = JSON.stringify({ version: 1, volume: { music: 0.5, sfx: 1 }, shake: 1, post: true });
    const s = parseSettings(v1)!;
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.touch.autoGas).toBe(true);
    expect(s.touch.layout).toBe('default');
    expect(s.quality).toBe('auto');
    expect(s.volume.music).toBe(0.5);
  });
  test('respeta valores v2 existentes y valida la forma', () => {
    const s = parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, quality: 'patata', touch: { autoGas: 'sí' } }))!;
    expect(s.quality).toBe('auto');
    expect(s.touch.autoGas).toBe(true);
  });
  test('rechaza versiones futuras', () => {
    expect(parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, version: 99 }))).toBeNull();
  });
});

describe('tiers iniciales (M3)', () => {
  test('manual gana; auto en Bun (sin móvil) es alta', () => {
    expect(initialTier('alta')).toBe('alta');
    expect(initialTier('ahorro')).toBe('ahorro');
    expect(initialTier('auto')).toBe('alta');
  });
});
