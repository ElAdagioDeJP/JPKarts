"""JP Kart soundtrack specs: one song per course + menu / tutorial / results / victory / defeat.

Each spec feeds build.py (composer + renderer). Progressions are "degree:quality" tokens, one per
bar-group (4 tokens = 2 bars each, 8 tokens = 1 bar each). Qualities: M m 7 M7 m7 s(us4) d(im) p(ower).
All songs are original compositions; the seed makes every melody deterministic.
"""

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixo': [0, 2, 4, 5, 7, 9, 10],
    'lydian': [0, 2, 4, 6, 7, 9, 11],
    'phryg': [0, 1, 3, 5, 7, 8, 10],
    'phrygdom': [0, 1, 4, 5, 7, 8, 10],
    'harmmin': [0, 2, 3, 5, 7, 8, 11],
}


def S(id, bpm, root, scale, a, b, lead, harm, bass, drums, seed, **kw):
    d = dict(id=id, bpm=bpm, root=root, scale=scale, prog_a=a.split(), prog_b=b.split(), lead=lead, lead2=None,
             harm=harm, hstyle='arp8', bass=bass, bstyle='root8', drums=drums, pad=None, ra=['drive', 'sync', 'drive', 'lilt'],
             rb=['drive', 'pulse', 'sync', 'long'], swing=0.0, sections=4, loop=True, seed=seed, density=1.0)
    d.update(kw)
    return d


SONGS = [
    # ---- courses (id = authored course id; legacy twins reuse the same file, see client/audio/songs.ts) ----
    S('pradera-jp', 148, 48, 'major', '0:M 4:M 5:m 3:M', '3:M 4:M 2:m 5:m 3:M 4:M 0:M 0:M', 80, 25, 33, 'pop', 101,
      lead2=11, hstyle='strum'),
    S('playa-coco', 118, 53, 'lydian', '0:M 1:M 0:M 4:M', '5:m 1:M 0:M 4:M', 114, 24, 33, 'tropic', 102,
      lead2=12, bstyle='tropic', ra=['sync', 'lilt', 'sync', 'long'], swing=0.04),
    S('tenis-jp', 157, 50, 'mixo', '0:M 6:M 3:M 0:M', '5:m 6:M 0:M 4:m', 80, 4, 38, 'break', 103,
      lead2=4, hstyle='arp16', bstyle='sync', ra=['arp', 'drive', 'arp', 'sync']),
    S('bosque-encantado', 129, 45, 'dorian', '0:m 3:M 0:m 6:M', '3:M 6:M 4:m 0:m', 8, 46, 32, 'half', 104,
      lead2=73, pad=91, bstyle='half', ra=['lilt', 'long', 'lilt', 'long'], rb=['sync', 'lilt', 'sync', 'long']),
    S('valle-molino', 141, 43, 'major', '0:M 3:M 4:M 0:M', '5:m 1:m 4:M 0:M', 21, 25, 32, 'folk', 105,
      lead2=73, bstyle='walk', ra=['lilt', 'sync', 'lilt', 'drive'], swing=0.06),
    S('dunas-doradas', 126, 50, 'phrygdom', '0:M 1:M 0:M 6:m', '3:m 0:M 1:M 0:M', 104, 24, 38, 'darbuka', 106,
      lead2=71, pad=48, bstyle='sync', ra=['sync', 'drive', 'sync', 'lilt']),
    S('bahia-atardecer', 111, 51, 'lydian', '0:M7 5:m7 1:m7 4:7', '3:M7 2:m7 1:m7 4:7', 64, 5, 35, 'pop', 107,
      lead2=4, pad=89, bstyle='walk', ra=['long', 'lilt', 'sync', 'long'], rb=['lilt', 'sync', 'lilt', 'long'], density=0.7, swing=0.07),
    S('glaciar-polar', 119, 52, 'minor', '0:m 5:M 2:M 6:M', '3:m 5:M 6:M 4:m', 9, 46, 39, 'half', 108,
      lead2=52, pad=89, bstyle='half', ra=['long', 'lilt', 'long', 'long'], rb=['lilt', 'pulse', 'lilt', 'long'], density=0.75),
    S('ciudad-neon', 140, 45, 'minor', '0:m 5:M 2:M 6:M', '3:m 5:M 6:M 0:m', 81, 90, 38, 'four', 109,
      lead2=62, hstyle='pump', bstyle='offbeat', ra=['sync', 'drive', 'sync', 'pulse']),
    S('selva-tropical', 132, 46, 'mixo', '0:M 6:M 0:M 3:M', '5:m 6:M 3:M 0:M', 73, 12, 33, 'tropic', 110,
      lead2=12, hstyle='stab', bstyle='tropic', ra=['sync', 'drive', 'sync', 'lilt'], swing=0.03),
    S('pico-nevado', 143, 50, 'major', '0:M 4:M 5:m 3:M', '5:m 3:M 0:M 4:M', 56, 48, 33, 'rock', 111,
      lead2=61, hstyle='pad', ra=['drive', 'lilt', 'drive', 'long'], rb=['drive', 'drive', 'sync', 'long']),
    S('estadio-central', 129, 52, 'major', '0:M 6:M 3:M 0:M', '5:m 3:M 4:M 4:M', 29, 16, 34, 'rock', 112,
      lead2=16, hstyle='strum', ra=['sync', 'drive', 'sync', 'long']),
    S('canon-rojo', 156, 52, 'minor', '0:m 6:M 5:M 4:M', '0:m 3:m 6:M 4:M', 27, 25, 34, 'rock', 113,
      lead2=22, hstyle='strum', ra=['drive', 'sync', 'drive', 'long']),
    S('autopista-laser', 181, 54, 'minor', '0:m 5:M 3:m 4:M', '5:M 6:M 0:m 0:m', 81, 81, 38, 'four', 114,
      lead2=87, hstyle='arp16', bstyle='gallop', ra=['arp', 'drive', 'arp', 'sync']),
    S('volcan-rugiente', 168, 50, 'phryg', '0:p 1:p 0:p 6:p', '5:p 6:p 1:p 0:p', 30, 30, 38, 'drive', 115,
      lead2=61, hstyle='pow', bstyle='gallop', ra=['sync', 'drive', 'sync', 'drive']),
    S('crater-ardiente', 178, 49, 'harmmin', '0:m 5:M 4:M 0:m', '3:m 4:M 5:M 4:M', 62, 30, 39, 'drive', 116,
      lead2=30, hstyle='pow', bstyle='gallop', ra=['drive', 'sync', 'drive', 'sync']),
    S('anillo-turbo', 168, 55, 'minor', '0:m 6:M 5:M 6:M', '3:m 6:M 5:M 4:M', 81, 81, 38, 'four', 117,
      lead2=87, hstyle='pump', bstyle='offbeat', ra=['arp', 'sync', 'arp', 'drive']),
    S('dunas-veloces', 136, 52, 'phrygdom', '0:M 1:M 0:M 6:m', '3:m 6:m 1:M 0:M', 71, 107, 38, 'darbuka', 118,
      lead2=104, hstyle='arp16', bstyle='sync', ra=['arp', 'drive', 'sync', 'drive']),
    S('arena-plaza', 148, 48, 'major', '0:M 3:M 0:M 4:M', '5:m 3:M 4:M 0:M', 11, 25, 33, 'pop', 119,
      lead2=80, bstyle='disco', ra=['drive', 'sync', 'drive', 'lilt'], sections=3),
    S('arena-crater', 156, 50, 'minor', '0:m 6:M 3:M 4:M', '5:M 6:M 0:m 4:M', 29, 16, 34, 'rock', 120,
      lead2=56, hstyle='strum', ra=['drive', 'sync', 'drive', 'long'], sections=3),
    S('arena-hielo', 119, 52, 'lydian', '0:M7 1:M 0:M7 4:M', '5:m7 1:M 0:M7 4:M', 9, 98, 39, 'half', 121,
      lead2=98, pad=89, hstyle='arp16', bstyle='half', ra=['lilt', 'pulse', 'lilt', 'long'], sections=3, density=0.8),
    S('arena-neon', 168, 45, 'minor', '0:m 3:m 5:M 4:M', '5:M 6:M 3:m 4:M', 81, 90, 38, 'four', 122,
      lead2=62, hstyle='pump', bstyle='offbeat', ra=['arp', 'sync', 'arp', 'drive'], sections=3),
    # ---- screens ----
    S('menu', 118, 53, 'major', '0:M 5:m 3:M 4:M', '3:M 4:M 2:m 5:m 3:M 4:M 0:M 4:M', 11, 4, 33, 'pop', 130,
      lead2=73, bstyle='walk', ra=['lilt', 'sync', 'long', 'lilt'], rb=['lilt', 'sync', 'lilt', 'long'], density=0.75),
    S('tutorial', 110, 48, 'major', '0:M 3:M 0:M 4:M', '5:m 3:M 0:M 4:M', 12, 25, 32, 'folk', 131,
      lead2=73, bstyle='walk', ra=['lilt', 'long', 'lilt', 'long'], sections=2, density=0.65),
    S('results', 100, 55, 'major', '0:M 5:m 3:M 4:M', '3:M 4:M 0:M 0:M', 4, 89, 33, 'half', 132,
      lead2=9, hstyle='arp8', ra=['long', 'lilt', 'long', 'lilt'], sections=2, density=0.6),
    S('victory', 150, 48, 'major', '0:M 3:M 4:M 0:M 5:m 3:M 4:M 0:M', '0:M', 56, 48, 33, 'pop', 133,
      lead2=61, ra=['drive', 'drive', 'sync', 'drive'], sections=1, loop=False),
    S('defeat', 76, 45, 'minor', '0:m 5:M 3:m 0:m', '0:m', 42, 48, 32, 'none', 134,
      lead2=70, hstyle='pad', bstyle='half', ra=['long', 'lilt', 'long', 'long'], sections=1, loop=False, density=0.5),
]
