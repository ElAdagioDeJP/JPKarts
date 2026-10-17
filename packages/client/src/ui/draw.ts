// 2D overlay drawing helpers (UI space: W×H logical pixels, 16:9).
import { OUT } from '../art/pixel';

export const W = 426, H = 240, UI_SCALE = 3;
export const FONT = '"Press Start 2P", ui-monospace, monospace';
/**
 * M2 táctil: el dedo tapa ~40 px, así que el tap-target mínimo es 56 px CSS.
 * Las hitboxes táctiles van separadas de las visuales: lo que se ve puede ser
 * pequeño (icono 24px) pero su zona de toque es ≥56px (ver TouchControls).
 */
export const TAP_MIN_PX = 56;

export class Ui {
  ctx: CanvasRenderingContext2D;
  constructor(public cv: HTMLCanvasElement) {
    cv.width = W * UI_SCALE;
    cv.height = H * UI_SCALE;
    this.ctx = cv.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(UI_SCALE, 0, 0, UI_SCALE, 0, 0);
    c.imageSmoothingEnabled = false;
  }
  txt(s: string, x: number, y: number, col = '#fff7e0', size = 8, align: CanvasTextAlign = 'left', out = OUT) {
    const ctx = this.ctx;
    ctx.font = size + 'px ' + FONT;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    const o = size >= 16 ? 1.5 : 1;
    ctx.fillStyle = out;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [o, o], [-o, o], [o, -o], [-o, -o]] as const) ctx.fillText(s, x + dx, y + dy);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }
  txtS(s: string, x: number, y: number, col = '#fff7e0', align: CanvasTextAlign = 'center') {
    const ctx = this.ctx;
    ctx.font = '6px ' + FONT;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = OUT;
    ctx.fillText(s, x + 0.5, y + 0.5);
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }
  panel(x: number, y: number, w: number, h: number, fill = '#241f55', edge = '#fff7e0') {
    const ctx = this.ctx;
    ctx.fillStyle = OUT; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = edge; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, Math.min(3, h));
  }
  /** Dim the whole canvas (it overshoots the logical area so a scaled-down screen still dims everything). */
  bg(a = 0.72) {
    this.ctx.fillStyle = 'rgba(27,23,64,' + a + ')';
    this.ctx.fillRect(-W, -H, W * 3, H * 3);
  }
  /** Small text wrapped to `maxW` logical px; returns the number of lines drawn. */
  wrap(s: string, x: number, y: number, maxW: number, col = '#fff7e0', align: CanvasTextAlign = 'center', lineH = 8) {
    this.ctx.font = '6px ' + FONT;
    const lines: string[] = [];
    let cur = '';
    for (const w of s.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && this.ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.forEach((l, i) => this.txtS(l, x, y + i * lineH, col, align));
    return lines.length;
  }
  img(cv: CanvasImageSource, x: number, y: number, w?: number, h?: number) {
    if (w == null) this.ctx.drawImage(cv, x, y);
    else this.ctx.drawImage(cv, x, y, w, h!);
  }
  trophy(x: number, y: number, col: string) {
    const ctx = this.ctx;
    ctx.fillStyle = OUT; ctx.fillRect(x - 11, y - 1, 22, 16);
    ctx.fillStyle = col; ctx.fillRect(x - 10, y, 20, 14);
    ctx.fillStyle = '#fff7e0'; ctx.fillRect(x - 7, y + 2, 3, 6);
    ctx.fillStyle = col; ctx.fillRect(x - 3, y + 14, 6, 5); ctx.fillRect(x - 7, y + 19, 14, 3);
  }
}
