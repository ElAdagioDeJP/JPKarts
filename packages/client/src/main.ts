import { Audio } from './audio/audio';
import { installHotTunables } from './dev/hotTunables';
import { Game } from './game';
import { Input } from './input/input';
import { WorldRenderer } from './render/world3d';
import { Ui } from './ui/draw';

async function boot() {
  await document.fonts.load('8px "Press Start 2P"');
  const stage = document.getElementById('stage') as HTMLElement;
  const worldCv = document.getElementById('world') as HTMLCanvasElement;
  const uiCv = document.getElementById('ui') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const renderer = new WorldRenderer();
  await renderer.init(worldCv, params.has('webgl'));
  const input = new Input();
  input.attach(window, stage);
  const game = new Game(renderer, new Ui(uiCv), input, new Audio());
  (window as any).__jpkart = game;
  installHotTunables((msg) => { console.info(msg); game.toast(msg); });
  setTimeout(() => stage.focus(), 50);
  const loop = (now: number) => {
    game.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = '<p style="padding:24px;font-family:monospace">No se pudo iniciar JP Kart: ' + String(e) + '</p>';
});
