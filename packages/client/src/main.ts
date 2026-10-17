import { Audio } from './audio/audio';
import { installHotTunables } from './dev/hotTunables';
import { loadDesktopSettings } from './settings';
import { loadDesktopProgress } from './meta/store';
import { loadDesktopProfile } from './meta/profile';
import { Game } from './game';
import { Input } from './input/input';
import { TouchControls } from './input/touch';
import { initialTier, isMobileDevice, lockLandscape, registerSW } from './mobile';
import { WorldRenderer } from './render/world3d';
import { Ui } from './ui/draw';

async function boot() {
  await document.fonts.load('8px "Press Start 2P"');
  const stage = document.getElementById('stage') as HTMLElement;
  const worldCv = document.getElementById('world') as HTMLCanvasElement;
  const uiCv = document.getElementById('ui') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const mobile = isMobileDevice() || params.has('mobile');
  if (mobile) document.body.classList.add('mobile');
  const renderer = new WorldRenderer();
  // M3: en móvil se arranca en ahorro (batería/calor); auto-downgrade si <40fps 3s.
  await renderer.init(worldCv, params.has('webgl'), { tier: initialTier(mobile ? 'ahorro' : 'alta'), antialias: !mobile });
  const input = new Input();
  input.attach(window, stage);
  const game = new Game(renderer, new Ui(uiCv), input, new Audio());
  if ((window as { jpkartDesktop?: unknown }).jpkartDesktop) document.body.classList.add('fullscreen');
  const ds = await loadDesktopSettings();
  if (ds) { game.settings = ds; game.applySettings(); }
  // M4: en móvil el reduceFlash va ON por defecto en instalaciones nuevas.
  try {
    if (mobile && !localStorage.getItem('jpkart.settings') && !localStorage.getItem('jpkart.settings.bak')) {
      game.settings.reduceFlash = true;
    }
  } catch { /* private mode */ }
  // M0/M3: la calidad guardada manda sobre el tier inicial.
  try {
    const q = game.settings.quality;
    if (q === 'alta' || q === 'ahorro') renderer.applyTier(q);
  } catch { /* noop */ }
  const dp = await loadDesktopProgress();
  if (dp) game.progress = dp;
  const dprof = await loadDesktopProfile();
  if (dprof) { game.profile = dprof; game.lanName = dprof.name || game.lanName; }
  // M1 táctil: el overlay alimenta el mismo Input (contrato steer/throttle/held).
  const touch = new TouchControls(game.settings.touch.autoGas);
  if (mobile || params.has('touch')) {
    touch.attach(stage, {
      onAnalog: (s) => input.setTouchAnalog(s),
      onItem: () => input.pressTouchItem(),
      onGesture: () => input.onFirstGesture?.(),
    });
  }
  game.applySettings();
  // M4 iOS: el primer tap táctil desbloquea el audio igual que el teclado.
  const prevGesture = input.onFirstGesture;
  input.onFirstGesture = () => {
    try { game.audio.resume(); } catch { /* noop */ }
    if (mobile) lockLandscape();
    prevGesture?.();
  };
  window.addEventListener('touchstart', () => { try { game.audio.resume(); } catch { /* noop */ } }, { passive: true });
  if (!game.profile.id || !game.profile.name) game.openWelcome(true); // first run: welcome, tutorial and name
  (window as any).__jpkart = game;
  installHotTunables((msg) => { console.info(msg); game.toast(msg); });
  const toUi = (e: PointerEvent): [number, number] => { const r = uiCv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 426, ((e.clientY - r.top) / r.height) * 240]; };
  stage.addEventListener('pointerdown', (e) => game.pointer('down', ...toUi(e)));
  stage.addEventListener('pointermove', (e) => game.pointer('move', ...toUi(e)));
  stage.addEventListener('pointerup', (e) => game.pointer('up', ...toUi(e)));
  // M0: el viewport virtual redimensiona el canvas; portrait no arranca (overlay).
  const resize = () => { try { renderer.assertSize(); } catch { /* noop */ } };
  try {
    (window.visualViewport ?? null)?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
  } catch { /* noop */ }
  // M0: ocultar la pestaña auto-pausa (respeta `paused`, no lo deshace).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'race' && !game.paused) game.paused = true;
  });
  // M1/M2: teclado virtual para los campos online/LAN (el canvas no convoca teclado).
  const mtext = document.getElementById('mobile-text') as HTMLInputElement | null;
  if (mtext) {
    mtext.addEventListener('input', () => {
      const v = mtext.value;
      mtext.value = '';
      for (const ch of v) input.typed.push(ch);
      input.onFirstGesture?.();
    });
    mtext.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') input.typed.push('Backspace');
      if (e.key === 'Enter') {
        e.preventDefault();
        (window as any).__jpkart?.onPress?.('Enter');
        mtext.blur();
      }
    });
    stage.addEventListener('pointerdown', () => {
      const st = (window as any).__jpkart?.state;
      const tm = (window as any).__jpkart?.input?.textMode;
      document.body.classList.toggle('typing', !!tm && (st === 'online' || st === 'lan'));
      if (mobile && tm && (st === 'online' || st === 'lan')) {
        try { mtext.focus({ preventScroll: false }); } catch { try { mtext.focus(); } catch { /* noop */ } }
      } else mtext.blur();
    });
  }
  // M4: botón de sonido visible (no hay tecla M en móvil).
  const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement | null;
  if (muteBtn) {
    const sync = () => { muteBtn.textContent = game.audio.muted ? 'Sonido: off' : 'Sonido: on'; };
    muteBtn.addEventListener('click', () => {
      game.audio.init();
      game.audio.muted = !game.audio.muted;
      try { game.audio.resume(); } catch { /* noop */ }
      sync();
    });
    sync();
  }
  // M0 PWA: registro solo en móvil + https.
  registerSW();
  setTimeout(() => stage.focus(), 50);
  let lastAutoGas = game.settings.touch.autoGas;
  const loop = (now: number) => {
    game.frame(now);
    try {
      document.body.classList.toggle('racing', game.state === 'race');
      if (game.settings.touch.autoGas !== lastAutoGas) {
        lastAutoGas = game.settings.touch.autoGas;
        touch.setAutoGas(lastAutoGas);
      }
    } catch { /* noop */ }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = '<p style="padding:24px;font-family:monospace">No se pudo iniciar JP Kart: ' + String(e) + '</p>';
});
