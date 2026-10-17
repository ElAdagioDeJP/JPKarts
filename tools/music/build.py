"""JP Kart soundtrack builder: songs.py specs -> MIDI -> SoundFont render (tinysoundfont) -> reverb -> seamless loop -> OGG + M4A.

Needs the nobu venv (midiutil, numpy, soundfile, tinysoundfont) and ffmpeg. The SoundFont is not in the repo:
  NOBU_SF2=path/to/GeneralUser-GS.sf2  C:\\Users\\nexte\\Tools\\nobu\\.venv\\Scripts\\python tools/music/build.py [id ...]
Output: packages/client/public/music/<id>.{ogg,m4a} + index.json; MIDI sources in tools/music/midi/.
"""
import glob, json, os, random, shutil, subprocess, sys

import numpy as np
import soundfile as sf
import tinysoundfont as tsf
from midiutil import MIDIFile

sys.path.insert(0, os.path.dirname(__file__))
from songs import SCALES, SONGS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'music')
MIDI_DIR = os.path.join(os.path.dirname(__file__), 'midi')
SR = 44100
QUAL = {'M': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'M7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], 's': [0, 5, 7], 'd': [0, 3, 6], 'p': [0, 7, 12]}
# channel plan: 0 lead, 1 harmony, 2 bass, 3 pad, 4 lead2, 9 drums
CH_VOL = {0: 108, 1: 84, 2: 112, 3: 70, 4: 78}
CH_PAN = {0: 64, 1: 44, 2: 64, 3: 84, 4: 82}

# rhythm banks: (start beat, duration) inside one 4/4 bar
RHY = {
    'drive': [(0, .5), (.5, .5), (1, .5), (1.5, .5), (2, 1), (3, .5), (3.5, .5)],
    'sync': [(0, .75), (.75, .75), (1.5, .5), (2, 1), (3, .5), (3.5, .5)],
    'long': [(0, 1.5), (1.5, .5), (2, 2)],
    'lilt': [(0, 1), (1, .5), (1.5, .5), (2, 1), (3, 1)],
    'pulse': [(i * .5, .5) for i in range(8)],
    'arp': [(i * .25, .25) for i in range(16)],
}


def scale_pitches(root, scale, lo, hi):
    return [p for p in range(lo, hi + 1) if (p - root) % 12 in scale]


def chord_of(token, root, scale):
    d, q = token.split(':')
    base = root + scale[int(d) % len(scale)]
    return base, QUAL[q]


def nearest_idx(sp, target):
    return min(range(len(sp)), key=lambda i: abs(sp[i] - target))


def chord_idx(sp, cbase, ivs, near):
    pcs = {(cbase + i) % 12 for i in ivs}
    cands = [i for i, p in enumerate(sp) if p % 12 in pcs]
    return min(cands, key=lambda i: abs(i - near))


def lead_phrase(rng, spec, sp, bars, chords, rhythms, ascend, start_idx, cadence):
    """4-bar phrase: motif, sequenced motif, rising bar, cadence. Returns [(beat, dur, pitch)] and last idx."""
    notes, idx = [], start_idx
    motif_deltas = None
    for b in range(bars):
        cbase, ivs = chords[b]
        rhy = RHY[rhythms[b % len(rhythms)]]
        strong = {0, 2}
        if b == 1 and motif_deltas and len(motif_deltas) == len(RHY[rhythms[0]]):
            rhy = RHY[rhythms[0]]
            first = chord_idx(sp, cbase, ivs, idx + rng.choice([-1, 0, 1, 2]))
            cur, deltas = first, motif_deltas
        else:
            first = chord_idx(sp, cbase, ivs, idx + rng.choice([-2, -1, 0, 1, 2]))
            cur, deltas = first, None
        for k, (s, d) in enumerate(rhy):
            if deltas is not None:
                if k: cur = max(0, min(len(sp) - 1, cur + deltas[k]))
            elif k:
                bias = 1 if (ascend and b >= 2) else (-1 if b == bars - 1 else 0)
                step = rng.choices([-2, -1, 0, 1, 2], weights=[1 - .2 * bias, 3 - bias, 1, 3 + bias, 1 + .2 * bias])[0]
                cur = max(0, min(len(sp) - 1, cur + step))
            if s in strong or (k == 0):
                cur = chord_idx(sp, cbase, ivs, cur)
            pitch = sp[cur]
            last = (b == bars - 1 and k == len(rhy) - 1)
            if last and cadence:
                cur = chord_idx(sp, cbase, ivs, cur); pitch = sp[cur]
            notes.append((b * 4 + s, d * 0.92 if d < 1.5 else d * 0.97, pitch))
        # real deltas for motif replay
        if b == 0:
            ps = [nearest_idx(sp, n[2]) for n in notes[-len(rhy):]]
            motif_deltas = [0] + [ps[i] - ps[i - 1] for i in range(1, len(ps))]
        idx = nearest_idx(sp, notes[-1][2])
    return notes, idx


def compose(spec):
    rng = random.Random(spec['seed'])
    root, scale = spec['root'], SCALES[spec['scale']]
    plan = {1: 'a', 2: 'ab', 3: 'aba', 4: 'aaba'}[spec['sections']]
    lo, hi = root + 12, root + 31
    sp = scale_pitches(root, scale, lo, hi)
    lead, lead2, harm, bass, pad, drum = [], [], [], [], [], []
    idx = len(sp) // 3
    bar0 = 0
    for si, sec in enumerate(plan):
        prog = spec['prog_a'] if sec == 'a' else spec['prog_b']
        per = 8 // len(prog)
        chords = [chord_of(prog[b // per], root, scale) for b in range(8)]
        rh = spec['ra'] if sec == 'a' else spec['rb']
        occ = plan[:si].count(sec)  # nth repeat of this section letter
        ascend = sec == 'b' or occ > 0
        full_form = spec['sections'] > 1 or spec['loop']
        # melody: two 4-bar phrases; the 2nd answers the 1st (up a step) and cadences
        for ph in range(2):
            ch = chords[ph * 4:ph * 4 + 4]
            sub_rng = random.Random(spec['seed'] * 31 + si * 7 + ph + (0 if occ == 0 else 100))
            notes, idx = lead_phrase(sub_rng, spec, sp, 4, ch, rh, ascend, idx + (1 if ph and sec == 'b' else 0), cadence=(ph == 1))
            for (b, d, p) in notes:
                lead.append((bar0 * 4 + ph * 16 + b, d, p, 100 if si % 2 == 0 else 104))
                if spec['lead2'] is not None and (sec == 'b' or occ > 0):
                    lead2.append((bar0 * 4 + ph * 16 + b, d, p + 12 if p + 12 <= hi + 7 else p, 74))
        for b in range(8):
            cbase, ivs = chords[b]
            gb = (bar0 + b) * 4
            last_bar = (si == len(plan) - 1 and b == 7)
            ending = last_bar and not spec['loop']
            if ending:
                lead = [n for n in lead if n[0] < gb] + [(gb, 3.6, root + 24, 108)]
                lead2 = [n for n in lead2 if n[0] < gb]
            # harmony
            hs, notes = spec['hstyle'], [cbase + 12 + i for i in ivs]
            if ending:
                harm += [(gb, 3.8, n, 70) for n in notes]; bass += [(gb, 3.8, root - 12, 100)]
            else:
                harm += harmony_bar(hs, gb, notes, spec, rng, sec, b)
                bass += bass_bar(spec['bstyle'], gb, cbase - 12 if cbase - 12 >= 28 else cbase, ivs, rng, b)
            if spec['pad'] is not None and (sec == 'b' or si > 0):
                pad += [(gb, 3.9, cbase + 12 + i, 54) for i in ivs[:3]]
            drum += drums_bar(spec['drums'], gb, si, b, sec, rng, last_bar, spec['loop'], spec['density'], ending)
        bar0 += 8
    return dict(lead=lead, lead2=lead2, harm=harm, bass=bass, pad=pad, drums=drum, bars=bar0)


def harmony_bar(style, gb, notes, spec, rng, sec, b):
    ev = []
    if style == 'arp8':
        seq = [notes[0], notes[1], notes[2], notes[1], notes[0] + 12 if len(notes) < 4 else notes[3], notes[2], notes[1], notes[2]]
        ev = [(gb + i * .5, .45, seq[i], 58) for i in range(8)]
    elif style == 'arp16':
        up = notes + [notes[0] + 12, notes[1] + 12]
        seq = up + up[::-1][1:-1]
        ev = [(gb + i * .25, .22, seq[i % len(seq)], 52 if i % 4 else 60) for i in range(16)]
    elif style == 'pump':
        ev = [(gb + s, .4, n, 64) for s in (.5, 1.5, 2.5, 3.5) for n in notes]
    elif style == 'stab':
        ev = [(gb + s, .3, n, 66) for s in (.75, 1.5, 2.75, 3.5) for n in notes]
    elif style == 'strum':
        for s, d in ((0, 1.9), (2, 1.9)):
            ev += [(gb + s + k * .03, d, n, 60) for k, n in enumerate(notes)]
    elif style == 'pow':
        ev = [(gb + s, .4, n, 76) for s in (0, .5, 1.5, 2, 2.5, 3.5) for n in (notes[0] - 12, notes[0], notes[0] + 7)]
    else:  # pad
        ev = [(gb, 3.9, n, 56) for n in notes]
    return ev


def bass_bar(style, gb, r, ivs, rng, b):
    ev, fifth = [], r + 7
    if style == 'root8':
        for i in range(8):
            ev.append((gb + i * .5, .45, r + (12 if i in (3, 7) else 0), 100 if i % 2 == 0 else 82))
    elif style == 'sync':
        for s, p in ((0, r), (.75, r), (1.5, fifth), (2, r), (2.75, r + 12), (3.5, fifth)):
            ev.append((gb + s, .5, p, 100))
    elif style == 'walk':
        third = r + ivs[1]
        for s, p in ((0, r), (1, third), (2, fifth), (3, third if b % 2 else r + 12 - 2)):
            ev.append((gb + s, .9, p, 98))
    elif style == 'disco':
        for i in range(8):
            ev.append((gb + i * .5, .4, r + (12 if i % 2 else 0), 100 if i % 2 == 0 else 86))
    elif style == 'half':
        ev = [(gb, 1.9, r, 98), (gb + 2, 1.9, fifth if b % 2 else r, 92)]
    elif style == 'offbeat':
        ev = [(gb + s, .45, r, 104) for s in (.5, 1.5, 2.5, 3.5)]
    elif style == 'gallop':
        ev = [(gb + i * .25, .22, r, 100 if i % 4 == 0 else 78) for i in range(16)]
    elif style == 'tropic':
        for s, p in ((0, r), (.75, fifth), (1.5, r), (2, r), (2.75, fifth), (3.5, r + 12)):
            ev.append((gb + s, .5, p, 100))
    else:
        ev = [(gb, 3.8, r, 100)]
    return ev


def drums_bar(style, gb, si, b, sec, rng, last_bar, loop, density, ending):
    K, SN, SS, CL, HC, HO, RD, CR, T1, T2, T3, CB, SH, CGL, CGH, BG, TB = 36, 38, 37, 39, 42, 46, 51, 49, 41, 45, 48, 56, 70, 64, 62, 60, 54
    if style == 'none' or (density < 0.55 and si == 0):
        return [(gb, .5, CR, 60)] if b == 0 and style != 'none' else []
    p = {
        'rock': dict(k=[0, 8, 10], s=[4, 12], h=range(0, 16, 2)),
        'pop': dict(k=[0, 6, 8, 14], s=[4, 12], h=range(0, 16, 2)),
        'four': dict(k=[0, 4, 8, 12], s=[4, 12], h=range(2, 16, 4), c=[4, 12], o=[2, 6, 10, 14]),
        'tropic': dict(k=[0, 10], s=[], h=range(0, 16, 2), x=[(SS, [3, 6, 12]), (CGL, [0, 8]), (CGH, [3, 6, 10, 14]), (SH, list(range(0, 16, 2)))]),
        'drive': dict(k=list(range(0, 16, 2)), s=[4, 12], h=[], x=[(RD, list(range(0, 16, 2)))]),
        'half': dict(k=[0, 10], s=[8], h=range(0, 16, 2)),
        'break': dict(k=[0, 10], s=[4, 12], h=range(0, 16, 1)),
        'darbuka': dict(k=[0, 8], s=[], h=[], x=[(CGL, [0, 8, 10]), (CGH, [3, 6, 12, 14]), (TB, [4, 12]), (SH, list(range(0, 16, 2)))]),
        'folk': dict(k=[0, 8], s=[4, 12], h=[], x=[(TB, list(range(0, 16, 2)))]),
    }[style]
    ev = []
    soft = 0.8 if (si == 0 and density < 1) else 1.0
    def add(note, steps, vel, dur=.2, ghost=0):
        for st in steps:
            if style in ('tropic',) and st % 2 == 1:
                continue
            v = int(vel * soft + rng.randint(-6, 4)) if st % 4 else int(vel * soft + rng.randint(-2, 6))
            ev.append((gb + st * .25, dur, note, max(30, min(127, v))))
    add(K, p['k'], 108); add(SN, p['s'], 100); add(HC, p['h'], 62)
    add(CL, p.get('c', []), 90); add(HO, p.get('o', []), 70, .3)
    for note, steps in p.get('x', []):
        add(note, steps, 84 if note != SH else 52)
    if b == 0 and not (si == 0 and density < 1):
        ev.append((gb, 1.0, CR, 96))
    if b == 7 and not ending:  # fill: snare/tom run on the last beat
        ev = [e for e in ev if e[0] < gb + 3]
        for i, n in enumerate((SN, SN, T3, T2, T1, T1, SN, SN)):
            ev.append((gb + 3 + i * .125, .12, n, 70 + i * 5))
        if last_bar and loop: ev.append((gb + 3.75, .3, CR, 100))
    if ending and b == 7:
        ev = [(gb, 2.5, CR, 110), (gb, .5, K, 110)]
    return ev


def find_ffmpeg():
    p = shutil.which('ffmpeg')
    if p: return p
    g = glob.glob(os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe'))
    return g[0] if g else None


def write_midi(spec, tr, path):
    m = MIDIFile(numTracks=6, deinterleave=False)
    names = [('lead', 0, spec['lead']), ('lead2', 4, spec['lead2']), ('harm', 1, spec['harm']), ('bass', 2, spec['bass']), ('pad', 3, spec['pad']), ('drums', 9, None)]
    for t, (n, ch, prog) in enumerate(names):
        m.addTempo(t, 0, spec['bpm']); m.addTrackName(t, 0, n)
        if prog is not None: m.addProgramChange(t, ch, 0, prog)
        key = 'drums' if n == 'drums' else n
        for (s, d, p, v) in tr[key]:
            m.addNote(t, ch, int(p), float(s), float(d), int(v))
    os.makedirs(MIDI_DIR, exist_ok=True)
    with open(path, 'wb') as f: m.writeFile(f)


def reverb(x, rng, secs=1.3, wet=0.17):
    n = int(SR * secs)
    t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n) * np.exp(-t * 4.2) for _ in range(2)], axis=1).astype(np.float32)
    ir *= 0.05
    size = 1 << (len(x) + n - 1).bit_length()
    out = np.zeros((len(x) + n - 1, 2), dtype=np.float32)
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:len(x) + n - 1]
    y = np.zeros_like(out); y[:len(x)] = x
    return y + wet * out


def render(spec, tr, sf2):
    bpm, bars = spec['bpm'], tr['bars']
    spb = 60.0 / bpm
    tail = 3.0
    synth = tsf.Synth(samplerate=SR)
    sfid = synth.sfload(sf2)
    chans = {0: spec['lead'], 1: spec['harm'], 2: spec['bass'], 3: spec['pad'], 4: spec['lead2']}
    for ch, prog in chans.items():
        if prog is None: continue
        synth.program_select(ch, sfid, 0, prog)
        synth.control_change(ch, 7, CH_VOL[ch]); synth.control_change(ch, 10, CH_PAN[ch])
    synth.program_select(9, sfid, 128, 0, is_drums=True)
    swing = spec['swing']
    ev = []
    for key, ch in (('lead', 0), ('harm', 1), ('bass', 2), ('pad', 3), ('lead2', 4), ('drums', 9)):
        for (s, d, p, v) in tr[key]:
            if swing and abs((s % 1) - 0.5) < 1e-6: s += swing
            ev.append((s * spb, 1, ch, int(p), int(v)))
            ev.append(((s + d) * spb, 0, ch, int(p), 0))
    ev.sort(key=lambda e: (e[0], e[1]))
    total = bars * 4 * spb + tail
    chunks, prev, BLOCK = [], 0.0, 2048
    done = 0
    for t, on, ch, p, v in ev:
        want = int(t * SR) - done
        while want > 0:
            n = min(BLOCK, want); chunks.append(np.frombuffer(bytes(synth.generate(n)), dtype=np.float32).reshape(-1, 2)); want -= n; done += n
        if on: synth.noteon(ch, p, v)
        else: synth.noteoff(ch, p)
    want = int(total * SR) - done
    while want > 0:
        n = min(BLOCK, want); chunks.append(np.frombuffer(bytes(synth.generate(n)), dtype=np.float32).reshape(-1, 2)); want -= n
    x = np.concatenate(chunks)
    x = reverb(x, np.random.default_rng(spec['seed']))
    L = int(bars * 4 * spb * SR)
    if spec['loop']:
        t = min(len(x) - L, int(tail * SR))
        x[:t] += x[L:L + t]
        x = x[:L]
    else:
        x = x[:L + int(1.6 * SR)]
        fade = int(.6 * SR); x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    rms = float(np.sqrt(np.mean(x ** 2)))
    x = x * (10 ** (-17 / 20) / max(rms, 1e-6))
    x = np.tanh(x / 0.95) * 0.95  # soft limit
    return x.astype(np.float32)


def encode(x, id, ffmpeg):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, id + '.tmp.wav')
    sf.write(wav, x, SR, subtype='FLOAT')
    ogg, m4a = os.path.join(OUT, id + '.ogg'), os.path.join(OUT, id + '.m4a')
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '3', ogg], check=True)
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', m4a], check=True)
    os.remove(wav)
    return os.path.getsize(ogg), os.path.getsize(m4a)


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('-')]
    sf2 = os.environ.get('NOBU_SF2') or r'C:\Users\nexte\Tools\nobu\assets\soundfonts\default.sf2'
    ff = find_ffmpeg()
    assert ff and os.path.exists(sf2), 'ffmpeg or soundfont missing'
    idx_path = os.path.join(OUT, 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    for spec in SONGS:
        if want and spec['id'] not in want: continue
        tr = compose(spec)
        write_midi(spec, tr, os.path.join(MIDI_DIR, spec['id'] + '.mid'))
        x = render(spec, tr, sf2)
        ogg, m4a = encode(x, spec['id'], ff)
        dur = len(x) / SR
        index[spec['id']] = dict(bpm=spec['bpm'], loop=spec['loop'], sec=round(dur, 2), ogg=ogg, m4a=m4a)
        print(f"{spec['id']:18s} {spec['bpm']:3d}bpm {dur:5.1f}s  ogg {ogg//1024:4d}K  m4a {m4a//1024:4d}K  peak {np.abs(x).max():.2f}", flush=True)
    json.dump(index, open(idx_path, 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
