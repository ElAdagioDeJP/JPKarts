// Recorded soundtrack (public/music/<file>.ogg|m4a, built by tools/music/build.py). The synth in audio.ts is the fallback.

/** Classic (procedural) courses share the song of their authored twin; every other id is its own file. */
const TWIN: Record<string, string> = {
  pradera: 'pradera-jp', playa: 'playa-coco', tenis: 'tenis-jp', bosque: 'bosque-encantado', molino: 'valle-molino',
  dunas: 'dunas-doradas', bahia: 'bahia-atardecer', glaciar: 'glaciar-polar', neon: 'ciudad-neon', selva: 'selva-tropical',
  pico: 'pico-nevado', estadio: 'estadio-central', canon: 'canon-rojo', laser: 'autopista-laser', volcan: 'volcan-rugiente',
  crater: 'crater-ardiente',
};

export const songFile = (trackId: string): string => TWIN[trackId] ?? trackId;

/** Screen songs: menu, tutorial, results, victory, defeat. */
export const SCREEN_SONGS = ['menu', 'tutorial', 'results', 'victory', 'defeat'] as const;
