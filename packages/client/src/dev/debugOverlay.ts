// Dev tools (docs/GDD.md §6.5 and §7.6):
//  F3 — track viewer/editor: sections, walls, surfaces, racing line, shortcuts, boxes, hazards; drag control
//       points of authored tracks and press S to save the JSON (dev server only).
//  F4 — AI overlay: current tactic, utility scores, item score and target point of every AI kart.
import { CHARS, aiDebug, type AuthoredTrackDef, type Track, type World } from '@jpkart/core';
import type { Ui } from '../ui/draw';

const SECTION_COL: Record<string, string> = {
  recta: '#9cff9c', chicane: '#ffe45e', horquilla: '#ff8a1f', 'curva-rapida': '#3df0ff', salto: '#b84aff',
  riesgo: '#ff4d6d', atajo: '#ffffff', descanso: '#8fb0ff', climax: '#ff3df0',
};
const SURF_COL: Record<string, string> = { arena: '#ecd08c', barro: '#7a5a3a', hielo: '#bff0ff', charco: '#4aa0e0' };

export class DebugOverlay {
  track = false;
  ai = false;
  /** map panel in UI coordinates */
  private box = { x: 96, y: 8, s: 224 };
  private drag = -1;
  dirty = false;

  /** World → panel coordinates. */
  private P(tr: Track, x: number, y: number): [number, number] {
    const k = this.box.s / tr.size;
    return [this.box.x + x * k, this.box.y + y * k];
  }

  draw(ui: Ui, tr: Track, w: World | null) {
    if (this.track) this.drawTrack(ui, tr, w);
    if (this.ai && w) this.drawAi(ui, w);
  }

  private drawTrack(ui: Ui, tr: Track, w: World | null) {
    const c = ui.ctx, { x, y, s } = this.box, N = tr.N;
    c.fillStyle = 'rgba(10,8,30,0.82)'; c.fillRect(x - 4, y - 4, s + 8, s + 8);
    const a = tr.authored;
    const secOf = (i: number) => { const f = i / N; return a?.sections.find((q) => q.type !== 'atajo' && f >= q.from && f < q.to)?.type ?? 'recta'; };
    // road with section colors
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, [ax, ay] = this.P(tr, tr.x[i]!, tr.y[i]!), [bx, by] = this.P(tr, tr.x[j]!, tr.y[j]!);
      c.strokeStyle = SECTION_COL[secOf(i)] ?? '#ccc'; c.lineWidth = Math.max(1, (tr.wd[i]! * 2 * s) / tr.size);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
    // walls
    c.fillStyle = '#ff2a2a';
    for (let i = 0; i < N; i += 2)
      for (const side of [-1, 1]) {
        if (!(side < 0 ? tr.wallL : tr.wallR)[i]) continue;
        const an = tr.ang[i]!, l = side * (tr.wd[i]! + 8), [px, py] = this.P(tr, tr.x[i]! - Math.sin(an) * l, tr.y[i]! + Math.cos(an) * l);
        c.fillRect(px - 0.5, py - 0.5, 1, 1);
      }
    // surfaces
    for (const sb of tr.surfaces) {
      c.fillStyle = SURF_COL[sb.kind] ?? '#888';
      for (let i = sb.i0; i !== sb.i1; i = (i + 1) % N) {
        if (i % 3) continue;
        const an = tr.ang[i]!, l = (sb.lat0 + sb.lat1) / 2, [px, py] = this.P(tr, tr.x[i]! - Math.sin(an) * l, tr.y[i]! + Math.cos(an) * l);
        c.fillRect(px - 1, py - 1, 2, 2);
      }
    }
    // racing line
    const line = tr.line;
    if (line) {
      c.strokeStyle = '#2eff6b'; c.lineWidth = 0.6; c.beginPath();
      for (let i = 0; i <= N; i++) { const [px, py] = this.P(tr, line.x[i % N]!, line.y[i % N]!); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
      c.stroke();
    }
    // shortcuts
    c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.setLineDash([2, 2]);
    for (const b of tr.branches) { c.beginPath(); b.x.forEach((bx, i) => { const [px, py] = this.P(tr, bx, b.y[i]!); if (i) c.lineTo(px, py); else c.moveTo(px, py); }); c.stroke(); }
    c.setLineDash([]);
    // boxes, pads, start
    c.fillStyle = '#d8f03a';
    for (const b of tr.boxes) { const [px, py] = this.P(tr, b.x, b.y); c.fillRect(px - 1, py - 1, 2, 2); }
    c.fillStyle = '#ff8a1f';
    for (const p of tr.pads) { const [px, py] = this.P(tr, p.x, p.y); c.fillRect(px - 1.5, py - 1.5, 3, 3); }
    // control points (authored): draggable
    if (a) a.spline.forEach((p, i) => {
      const [px, py] = this.P(tr, p.x, p.y);
      c.fillStyle = i === 0 ? '#ff3df0' : i === this.drag ? '#ffffff' : '#3df0ff';
      c.fillRect(px - 2, py - 2, 4, 4);
      ui.txtS(String(i), px + 3, py - 3, '#9cc', 'left');
    });
    // live entities and karts
    if (w) {
      for (const e of w.ents) { const [px, py] = this.P(tr, e.x, e.y); c.fillStyle = e.kind === 'ola' ? '#ffffff' : '#ff4d6d'; c.fillRect(px - 1, py - 1, 3, 3); }
      for (const k of w.karts) { const [px, py] = this.P(tr, k.x, k.y); c.fillStyle = CHARS[k.ch]!.kart; c.fillRect(px - 2, py - 2, 4, 4); }
      if (tr.water) ui.txtS(`agua ${w.water.toFixed(1)}`, x + 2, y + s - 8, '#58b8f0', 'left');
    }
    ui.txtS(`F3 · ${tr.def.name} · ${N} muestras · ${(N * 6) | 0} u${a ? (this.dirty ? ' · S: guardar*' : ' · arrastra los puntos') : ''}`, x + s / 2, y + s + 2, '#fff7e0');
  }

  private drawAi(ui: Ui, w: World) {
    let row = 0;
    for (const k of w.karts) {
      if (k.ctrl !== 'ai') continue;
      const d = aiDebug.get(k.id);
      if (!d) continue;
      const top = Object.entries(d.scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${v.toFixed(2)}`).join(' ');
      ui.txtS(`${CHARS[k.ch]!.short.padEnd(7)} ${d.act.padEnd(10)} v ${k.speed.toFixed(0)}/${d.vt.toFixed(0)}  obj ${d.item.toFixed(2)}  ${top}`, 4, 40 + row * 8, '#9cff9c', 'left');
      row++;
    }
    ui.txtS('F4 · IA: táctica · velocidad/objetivo · aiScore del objeto · utilidades', 4, 32, '#fff7e0', 'left');
  }

  // ---- editor (authored tracks) ----
  /** Mouse in UI coordinates. Returns true when the track geometry changed. */
  pointer(kind: 'down' | 'move' | 'up', ux: number, uy: number, tr: Track): boolean {
    const a = tr.authored;
    if (!this.track || !a) return false;
    const k = tr.size / this.box.s, wx = (ux - this.box.x) * k, wy = (uy - this.box.y) * k;
    if (kind === 'down') {
      let best = -1, bd = 12 * k;
      a.spline.forEach((p, i) => { const d = Math.hypot(p.x - wx, p.y - wy); if (d < bd) { bd = d; best = i; } });
      this.drag = best;
      return false;
    }
    if (kind === 'move' && this.drag >= 0) {
      const p = a.spline[this.drag]!;
      p.x = Math.round(wx); p.y = Math.round(wy);
      return false;
    }
    if (kind === 'up' && this.drag >= 0) { this.drag = -1; this.dirty = true; return true; }
    return false;
  }

  /** Save the authored JSON through the dev server (see vite.config.ts). */
  async save(a: AuthoredTrackDef): Promise<string> {
    const r = await fetch('/__jpkart/save-track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
    if (!r.ok) return 'No se pudo guardar: ' + (await r.text());
    this.dirty = false;
    return `Guardada core/data/tracks/${a.id}.json`;
  }
}
