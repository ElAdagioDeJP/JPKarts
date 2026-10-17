# Banda sonora de JP Kart

Una canción original por pista (22 cursos + 4 arenas, las 16 clásicas comparten la de su gemela) más cinco de pantalla:
`menu`, `tutorial` (bienvenida), `results` (resultados y clasificación), `victory` y `defeat` (podio/final, según el puesto; no hacen loop).
Archivos: `packages/client/public/music/<id>.ogg|m4a` + `index.json` (bpm, loop, duración, bytes). ~25 MB por formato.

## Cómo suena en el juego
- `Game.songPick()` (game.ts) elige el archivo según el estado; `Audio.musicFile()` lo decodifica (WebAudio), lo cachea (Cache API `jpkart-music-v1`) y lo reproduce en bucle exacto por el bus de música (ducking y volumen siguen funcionando).
- **Última vuelta:** `playbackRate` 1.06 con rampa suave (sube el tono ~1 semitono, como los clásicos).
- **Respaldo:** si el archivo no existe o no decodifica (p. ej. navegador sin OGG ni AAC), suena el sintetizador procedural de `audio.ts`. Safari/iOS usa el `.m4a`.
- La pista se precarga durante la cuenta atrás; el archivo no se vuelve a pedir en la sesión.

## SFX
`feel/itemSfx.ts`: una receta sintetizada (WebAudio) por objeto (32 ids), audible por distancia (300 u) y con panning estéreo; `hitImpact` es el mismo golpe en todos los mapas, bajo el grito del personaje (`groan`).

## Regenerar
Fuera del repo viven nobu (`C:\Users\nexte\Tools\nobu`, venv con `midiutil`, `numpy`, `soundfile`, `tinysoundfont`), ffmpeg y el SoundFont GeneralUser GS (`default.sf2`).
```
C:\Users\nexte\Tools\nobu\.venv\Scripts\python tools/music/build.py            # las 27
C:\Users\nexte\Tools\nobu\.venv\Scripts\python tools/music/build.py playa-coco # una
```
`tools/music/songs.py` define cada canción (bpm, tonalidad, escala, progresiones A/B, instrumentos GM, estilo de batería/bajo/armonía, semilla). `build.py` compone (melodía por frases con motivo, secuencia y cadencia; bajo, armonía, pad y batería con relleno), escribe el MIDI en `tools/music/midi/`, renderiza con el SoundFont, añade reverb, pliega la cola para un bucle sin corte, normaliza (-17 dBFS RMS) y codifica OGG (q3) + M4A (112 kbps).
Cambiar `seed` o la progresión rehace la melodía; tras regenerar, sube `jpkart-music-v1` en `audio.ts` si quieres invalidar la caché de los jugadores.

## Pruebas
`bun test` (cada pista y pantalla tiene su .ogg y .m4a, ≤1,5 MB) · `node tools/songs-check.mjs --track-slot=N` (navegador: qué canción suena en bienvenida, menú y carrera; recorre las 32 recetas de SFX).
