// Input router: key/pad presses become screen transitions (extracted from game.ts).
// One switch per state; each case is 1-3 lines and delegates to its screen module.
// New states register a case here without touching race/render code.
import { CHARS, CLASSES, CUPS, classUnlocked, cupUnlocked, recordCup } from '@jpkart/core';
import { saveProgress } from '../meta/store';
import { welcomeInput } from '../screens/welcome';
import { isArena, type Mode } from './types';
import { spectateStep, spectating } from '../race/spectate';
import type { Game } from '../game';

/** Cup/track screens: X cycles the engine class (only unlocked ones), E toggles teams (race and cup). */
export function classKeys(g: Game, code: string): boolean {
  if (code === 'KeyX' || code === 'Pad2') {
    const open = CLASSES.filter((c) => classUnlocked(g.progress, c, g.allUnlocked));
    g.cls = open[(open.indexOf(g.cls) + 1) % open.length]!;
    g.audio.blip();
    return true;
  }
  if ((code === 'KeyE' || code === 'Pad1') && (g.mode === 'free' || g.mode === 'cup')) {
    g.teams = !g.teams; g.audio.blip(); return true;
  }
  return false;
}

export function textNav(g: Game, code: string, U: boolean, D: boolean): [boolean, boolean] {
  return g.input.textMode
    ? [code === 'ArrowUp' || code === 'Pad12', code === 'ArrowDown' || code === 'Pad13']
    : [U, D];
}

export function onPress(g: Game, code: string) {
  const I = g.input, A = g.audio;
  const ok = I.is(code, 'aceptar'), back = I.is(code, 'atras');
  const L = I.is(code, 'izquierda'), R = I.is(code, 'derecha'), U = I.is(code, 'arriba'), D = I.is(code, 'abajo');
  if (I.is(code, 'sonido') && !I.textMode) A.muted = !A.muted;
  if (code === 'F2') g.showPerf = !g.showPerf;
  if (code === 'F3') g.dbg.track = !g.dbg.track;
  if (code === 'F4') g.dbg.ai = !g.dbg.ai;
  if (code === 'KeyS' && g.dbg.track && g.dbg.dirty && g.tr.authored)
    void g.dbg.save(g.tr.authored).then((m) => g.toast(m));
  if (code === 'PageUp' && g.dbg.track && g.tr.authored && g.dbg.bumpHeight(g.tr, 1)) g.rebuildAuthored();
  if (code === 'PageDown' && g.dbg.track && g.tr.authored && g.dbg.bumpHeight(g.tr, -1)) g.rebuildAuthored();
  switch (g.state) {
    case 'title': if (ok) { g.state = 'menu'; A.blip(); } break;
    case 'welcome': welcomeInput(g, code, ok, back, L, R); break;
    case 'menu':
      if (U) { g.menuSel = (g.menuSel + 8) % 9; A.blip(); }
      if (D) { g.menuSel = (g.menuSel + 1) % 9; A.blip(); }
      if (g.menuSel === 7 && (L || R || ok)) { g.diff = (g.diff + (L ? 2 : 1)) % 3; A.blip(); break; }
      if (g.menuSel === 8 && ok) { g.state = 'options'; g.optSel = 0; A.blip(); break; }
      if (g.menuSel === 6 && ok) { g.state = 'lan'; g.lanField = 0; g.input.textMode = true; A.blip(); break; }
      if (g.menuSel === 5 && ok) { g.state = 'online'; g.onlineField = g.onlineAddr ? 2 : 1; g.input.textMode = true; A.blip(); break; }
      if (ok) {
        g.mode = (['cup', 'free', 'timetrial', 'elimination', 'battle'] as Mode[])[g.menuSel]!;
        g.trackSel = 0;
        if (g.mode !== 'free' && g.mode !== 'cup') g.teams = false;
        g.state = 'select'; A.blip();
      }
      if (back) g.state = 'title';
      break;
    case 'options': g.optionsInput(code, ok, back, L, R, U, D); break;
    case 'lan': g.lanInput(code, back, ...textNav(g, code, U, D)); break;
    case 'online': g.onlineInput(code, back, ...textNav(g, code, U, D)); break;
    case 'lobby': g.lobbyInput(code, ok, back, L, R, U, D); break;
    case 'controls': g.controlsInput(code, ok, back, U, D); break;
    case 'select':
      if (R) { g.sel = (g.sel + 1) % CHARS.length; A.blip(); }
      if (L) { g.sel = (g.sel + CHARS.length - 1) % CHARS.length; A.blip(); }
      if (D) { g.sel = (g.sel + 4) % CHARS.length; A.blip(); } // grid of 4 columns
      if (U) { g.sel = (g.sel + CHARS.length - 4) % CHARS.length; A.blip(); }
      if ((code === 'KeyJ' || code === 'Pad8') && g.mode !== 'timetrial') { g.players = (g.players % 4) + 1; A.blip(); }
      if (ok) { g.state = g.mode === 'cup' ? 'cup' : 'track'; A.beep(780, 0.1); }
      if (back) g.state = 'menu';
      break;
    case 'cup':
      if (classKeys(g, code)) break;
      if (R) { g.cupSel = (g.cupSel + 1) % 4; A.blip(); }
      if (L) { g.cupSel = (g.cupSel + 3) % 4; A.blip(); }
      if (U || D) { g.cupSel = (g.cupSel + 2) % 4; A.blip(); }
      if (ok && !cupUnlocked(g.progress, g.cupSel, g.allUnlocked)) {
        g.banner = { t: 'Consigue podio en la copa anterior', life: 1.5 };
        A.beep(160, 0.15, 'square', 0.05); break;
      }
      if (ok) {
        g.cup = { def: CUPS[g.cupSel]!, race: 0, pts: Object.fromEntries(CHARS.map((_, i) => [i, 0])), gain: {}, committed: false };
        g.startRace(g.cup.def.tracks[0]!); A.beep(880, 0.12);
      }
      if (back) g.state = 'select';
      break;
    case 'track': {
      const n = g.grid.length;
      if (R) { g.trackSel = (g.trackSel + 1) % n; A.blip(); }
      if (L) { g.trackSel = (g.trackSel + n - 1) % n; A.blip(); }
      if (D && n > 4) { g.trackSel = (g.trackSel + 4) % n; A.blip(); }
      if (U && n > 4) { g.trackSel = (g.trackSel + n - 4) % n; A.blip(); }
      if (isArena(g.mode) && (code === 'KeyC' || code === 'Tab' || code === 'Pad3')) {
        g.mode = g.mode === 'battle' ? 'capture' : 'battle'; A.blip(); break;
      }
      if (classKeys(g, code)) break;
      if (!isArena(g.mode) && (code === 'KeyC' || code === 'Tab' || code === 'Pad3')) {
        g.classic = !g.classic; g.trackSel = 0; A.blip();
      }
    }
      if (ok) { g.startRace(g.grid[g.trackSel]!); A.beep(880, 0.12); }
      if (back) g.state = 'select';
      break;
    case 'race':
      if (g.net && back) { g.leaveNet(); return; }
      if (g.net && spectating(g)) { if (L) spectateStep(g, -1); if (R) spectateStep(g, 1); }
      if (g.net) { if (g.views.length === 1 && I.is(code, 'objeto')) g.itemPressed = true; break; }
      if (I.is(code, 'pausa') || (back && !g.paused)) { g.paused = !g.paused; A.beep(440, 0.06); return; }
      if (g.paused && back) { g.paused = false; g.state = 'menu'; g.world = null; g.renderer.clearKarts(); A.engineSet(false, 0); return; }
      if (g.paused && code === 'Enter') { g.paused = false; return; }
      if (!g.paused && g.views.length === 1 && I.is(code, 'objeto')) g.itemPressed = true;
      break;
    case 'results':
      if (g.net) { if (ok && g.net.isHost) g.net.send({ t: 'next' }); if (back) g.leaveNet(); break; } // the server starts the next race by itself; the host's Enter only skips the wait
      if (code === 'KeyR' && g.lastReplay) { g.startReplayView(); break; }
      if (ok) {
        if (g.mode === 'cup') { g.commitPoints(); g.state = 'standings'; }
        else if (g.mode === 'timetrial') g.startRace(g.curTrack);
        else { g.state = 'podium'; A.jingle(); }
      }
      if (back && g.mode !== 'cup') g.toMenu();
      break;
    case 'podium':
      if (code === 'KeyR' && g.lastReplay) { g.startReplayView(); break; }
      if (ok) g.startRace(g.curTrack);
      if (back) g.toMenu();
      break;
    case 'replay': if (ok || back || code === 'KeyR') g.endReplayView(); break;
    case 'standings':
      if (ok && g.cup) {
        if (g.cup.race < g.cup.def.tracks.length - 1) {
          g.cup.race++; g.cup.committed = false; g.startRace(g.cup.def.tracks[g.cup.race]!);
        } else {
          const place = g.standingsList().indexOf(g.sel) + 1;
          g.resultNotes = recordCup(g.progress, CUPS.indexOf(g.cup.def), g.cls, place);
          saveProgress(g.progress);
          g.state = 'final'; A.jingle();
        }
      }
      break;
    case 'final': if (ok || back) g.toMenu(); break;
  }
}
