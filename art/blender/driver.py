"""Chibi 3D drivers for every pilot but JP (JP keeps driver_jp.py, approved as is). docs/V3_PLAN.md §2.3, §4.2.
Colours and accessories come from packages/core/data/characters.json; the body build per pilot is in BODY below.
Run:  blender -b --python art/blender/driver.py -- marco            (geometry + review renders)
      blender -b --python art/blender/driver.py -- marco --export   (rig, 7 clips, LOD1, .glb, pose renders)
Materials (7, one more than the plan's 6 because the iris colour differs from every accessory): skin, helmet, suit, hair (mouth and
blush; also the goatee), eyes (cream: sclera, gloves, stripes), acc (accessory / beard / glasses frames), iris (iris and glasses of JP-style).
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import lib
import rig as rig_mod

IDS = ['marco', 'guaycaipuro', 'luis', 'jesus', 'miguel', 'jp', 'mario', 'andres', 'edu', 'diego', 'angel', 'henry']
# w = body width (1 = JP, heavy), hk = torso height factor, skin/suit stay in the JSON
BODY = dict(
    marco=dict(w=0.86, hk=1.0), guaycaipuro=dict(w=0.96, hk=1.0), luis=dict(w=1.10, hk=1.0), jesus=dict(w=0.93, hk=1.0),
    miguel=dict(w=1.0, hk=1.0), mario=dict(w=1.0, hk=1.0), andres=dict(w=0.86, hk=1.0), edu=dict(w=0.76, hk=1.04),
    diego=dict(w=1.16, hk=1.12), angel=dict(w=0.94, hk=1.14), henry=dict(w=0.86, hk=1.04),
)
THICK_GLASSES = {'henry'}
TARGET_Z = 0.45
LOD1_TRIS = 1400


def shade(h, f):
    h = h.lstrip('#')
    return '#' + ''.join('%02x' % max(0, min(255, round(int(h[i:i + 2], 16) * f))) for i in (0, 2, 4))


def load_char(pid):
    path = os.path.join(lib.ROOT, 'packages', 'core', 'data', 'characters.json')
    c = json.load(open(path, encoding='utf-8'))[IDS.index(pid)]
    c.setdefault('suit', shade(c['helmet'], 0.72))
    c.setdefault('eye', '#20306e')
    return c


def build(pid):
    c = load_char(pid)
    b = BODY[pid]
    w, hk = b['w'], b['hk']
    lib.reset()
    lib.setup_world()
    Mc = dict(skin=c['skin'], helmet=c['helmet'], suit=c['suit'], hair=c['mouth'], eyes='#fff7e0', acc=c['accCol'], iris=c['eye'])
    if c.get('goatee'):  # the goatee needs its own colour: `hair` takes it, the mouth goes to `acc` (dark)
        Mc['hair'] = c.get('beardCol', '#3a2418')
    if c.get('beard'):
        Mc['acc'] = c.get('beardCol', '#3a2418') if c['acc'] == 'none' else Mc['acc']
    M = {k: lib.material(k, v) for k, v in Mc.items()}
    mouth_mat = M['acc'] if c.get('goatee') else M['hair']
    parts = []

    def add(o, bone):
        parts.append((o, bone))
        return o

    glasses = c['acc'] == 'glasses'
    HC = (0.0, 0.0, 0.725)
    FC, FR = (0.0, 0.112, 0.700), (0.168, 0.135, 0.138)

    def face_y(x, z, lift=0.0):
        t = 1 - (x / FR[0]) ** 2 - ((z - FC[2]) / FR[2]) ** 2
        return FC[1] + FR[1] * (max(t, 0.0) ** 0.5) + lift

    def on_helmet(phi_deg, x=0.0, grow=1.0):
        """Point + outward normal on the helmet at azimuth phi (0 = front horizon, 90 = top), lateral offset x."""
        a = math.radians(phi_deg)
        k = (1 - (x / 0.236) ** 2) ** 0.5
        p = (x, 0.232 * k * math.cos(a) * grow, HC[2] + 0.224 * k * math.sin(a) * grow)
        n = (x / 0.236 ** 2, math.cos(a) / 0.232, math.sin(a) / 0.224)
        L = math.sqrt(sum(v * v for v in n))
        return p, tuple(v / L for v in n)

    # ---- head: helmet, face, nose, eyes, mouth
    add(lib.ellipsoid('helmet', HC, (0.236, 0.232, 0.224), M['helmet'], segs=24, rings=16), 'head')
    add(lib.ellipsoid('face', FC, FR, M['skin'], segs=20, rings=12), 'head')
    add(lib.ellipsoid('nose', (0.0, face_y(0, 0.682, 0.006), 0.682), (0.017, 0.017, 0.014), M['skin'], segs=8, rings=6), 'head')
    fr = 0.011 if pid in THICK_GLASSES else 0.0065
    for s in (-1, 1):
        ex, ez = s * 0.066, 0.732
        add(lib.ellipsoid(f'eye{s}', (ex, face_y(ex, ez, 0.002), ez), (0.048, 0.012, 0.062), M['eyes'], segs=12, rings=8), 'head')
        add(lib.ellipsoid(f'iris{s}', (ex, face_y(ex, ez, 0.010), ez - 0.004), (0.031, 0.006, 0.047), M['iris'], segs=8, rings=5), 'head')
        add(lib.ellipsoid(f'glint{s}', (ex - s * 0.011, face_y(ex, ez, 0.017), ez + 0.017), (0.0085, 0.003, 0.011), M['eyes'], segs=6, rings=4), 'head')
        if glasses:
            ring = [(ex + 0.060 * math.cos(2 * math.pi * k / 18), face_y(ex + 0.060 * math.cos(2 * math.pi * k / 18), ez + 0.068 * math.sin(2 * math.pi * k / 18), 0.012), ez + 0.068 * math.sin(2 * math.pi * k / 18)) for k in range(19)]
            add(lib.tube(f'frame{s}', ring, fr, M['acc'], sides=4, taper=1.0), 'head')
            add(lib.tube(f'temple{s}', [(s * 0.126, face_y(0.126, ez, 0.012), ez + 0.004), (s * 0.205, 0.060, ez + 0.012), (s * 0.228, -0.040, ez + 0.010)], fr + 0.0008, M['acc'], sides=5), 'head')
        if not c.get('beard'):
            add(lib.ellipsoid(f'blush{s}', (s * 0.112, face_y(s * 0.112, 0.668, 0.003), 0.668), (0.022, 0.005, 0.013), M['hair'], segs=8, rings=5), 'head')
    if glasses:
        add(lib.tube('bridge', [(-0.030, face_y(0.03, 0.74, 0.024), 0.742), (0.0, face_y(0, 0.745, 0.027), 0.748), (0.030, face_y(0.03, 0.74, 0.024), 0.742)], fr, M['acc'], sides=4), 'head')
    smile = [(x * 0.014, face_y(x * 0.014, 0.638 + 0.0022 * x * x, 0.006), 0.638 + 0.0022 * x * x) for x in range(-4, 5)]
    add(lib.tube('mouth', smile, 0.0062, mouth_mat, sides=6, taper=0.45), 'head')

    # ---- beard / goatee
    if c.get('beard'):
        bd = lib.ellipsoid('beard', (FC[0], FC[1] - 0.004, FC[2]), (FR[0] * 1.04, FR[1] * 1.10, FR[2] * 1.13), M['acc'], segs=20, rings=12)
        lib.clamp_z(bd, hi=-0.086)  # everything above the mouth line is flattened away
        add(bd, 'head')
    if c.get('goatee'):
        add(lib.ellipsoid('goatee', (0.0, face_y(0, 0.592, 0.004), 0.592), (0.040, 0.034, 0.052), M['hair'], segs=10, rings=6), 'head')

    # ---- accessory
    A = M['acc']
    acc = c['acc']
    if acc == 'mohawk':
        for i, phi in enumerate(range(22, 160, 14)):
            p, n = on_helmet(phi)
            h = 0.06 + 0.09 * math.sin(math.radians(phi))
            tip = tuple(p[j] + n[j] * h for j in range(3))
            base = tuple(p[j] - n[j] * 0.012 for j in range(3))
            add(lib.cylinder(f'mohawk{i}', base, tip, 0.034, A, segs=6, r1=0.006), 'head')
    elif acc == 'spikes':
        for i, x in enumerate((-0.10, 0.0, 0.10)):
            ph = 90 - (14 if x else 0)
            p, n = on_helmet(90 if x == 0 else 78, x=x)
            tip = tuple(p[j] + n[j] * (0.19 if x == 0 else 0.16) for j in range(3))
            add(lib.cylinder(f'spike{i}', tuple(p[j] - n[j] * 0.015 for j in range(3)), tip, 0.052, A, segs=7, r1=0.004), 'head')
    elif acc == 'tuft':
        add(lib.ellipsoid('tuft_a', (0.03, 0.0, 0.725 + 0.224 + 0.03), (0.045, 0.04, 0.075), A, segs=10, rings=6), 'head')
        add(lib.ellipsoid('tuft_b', (-0.03, 0.01, 0.725 + 0.224 + 0.012), (0.035, 0.034, 0.055), A, segs=10, rings=6), 'head')
    elif acc == 'headphones':
        band = [(0.252 * math.cos(math.radians(t)), 0.0, HC[2] + 0.244 * math.sin(math.radians(t)) + 0.004) for t in range(0, 181, 12)]
        add(lib.tube('band', band, 0.016, A, sides=6, taper=1.0), 'head')
        for s in (-1, 1):
            add(lib.cylinder(f'cup{s}', (s * 0.232, 0.0, 0.712), (s * 0.292, 0.0, 0.712), 0.078, A, segs=14), 'head')
            add(lib.ellipsoid(f'pad{s}', (s * 0.236, 0.0, 0.712), (0.018, 0.07, 0.07), M['suit'], segs=10, rings=6), 'head')
    elif acc == 'antenna':
        add(lib.cylinder('stalk', (0.03, 0.02, 0.93), (0.05, 0.03, 1.08), 0.008, A, segs=6), 'head')
        add(lib.ellipsoid('bulb', (0.05, 0.03, 1.105), (0.034, 0.034, 0.034), A, segs=10, rings=6), 'head')
    elif acc == 'cap':
        dome = lib.ellipsoid('cap', (0.0, 0.0, 0.725 + 0.012), (0.248, 0.244, 0.236), A, segs=24, rings=12)
        lib.clamp_z(dome, lo=0.085)
        add(dome, 'head')
        add(lib.ellipsoid('brim', (0.0, 0.215, 0.822), (0.17, 0.135, 0.014), A, segs=16, rings=5, rot=(math.radians(-10), 0, 0)), 'head')
        add(lib.ellipsoid('cap_button', (0.0, 0.0, 0.725 + 0.012 + 0.236), (0.022, 0.022, 0.014), A, segs=8, rings=4), 'head')
    if pid == 'edu':  # straight black hair with a side parting, peeking out under the helmet
        add(lib.ellipsoid('fringe', (0.03, face_y(0.03, 0.826, 0.0), 0.826), (0.11, 0.014, 0.016), M['acc'], segs=12, rings=5, rot=(0, math.radians(-6), math.radians(6))), 'head')

    # helmet racing stripes (back of the head readable), unless the accessory already covers the top
    if acc not in ('mohawk', 'spikes', 'cap'):
        smat = M['acc'] if c['helmet'].lower() in ('#f4f1ff', '#ffffff') else M['eyes']
        for x0 in (-0.052, 0.052):
            k = (1 - (x0 / 0.236) ** 2) ** 0.5
            pts = [(x0, 0.232 * k * 0.995 * math.cos(math.radians(t)), 0.725 + 0.224 * k * 0.995 * math.sin(math.radians(t))) for t in range(30, 215, 12)]
            add(lib.tube(f'stripe{x0}', pts, 0.012, smat, sides=4, taper=0.7), 'head')

    # ---- torso and body (width w, torso height hk); the neck is gone: the head sits on the torso
    rz = 0.185 * hk
    zc = 0.07 + rz
    top = zc + rz
    rx, ry = 0.165 * w, 0.115 * (0.55 + 0.45 * w)
    add(lib.ellipsoid('torso', (0.0, 0.0, zc), (rx, ry, rz), M['suit'], segs=16, rings=10), 'chest')
    stripe = [(0.0, -ry * (1 - ((top - 0.04 - 0.03 * i - zc) / rz) ** 2) ** 0.5 - 0.004, top - 0.04 - 0.03 * i) for i in range(0, 8)]
    add(lib.tube('back_stripe', stripe, 0.012, M['acc'] if c['helmet'].lower() in ('#f4f1ff',) else M['eyes'], sides=4, taper=0.9), 'chest')
    add(lib.ellipsoid('pelvis', (0.0, -0.01, 0.075), (0.15 * w, 0.115 * (0.55 + 0.45 * w), 0.085), M['suit'], segs=10, rings=6), 'spine')
    add(lib.box('belt', (0.0, 0.0, 0.115), (0.31 * w, 0.24 * (0.55 + 0.45 * w), 0.035), M['suit'], bevel=0.008), 'spine')
    for s in (-1, 1):
        add(lib.capsule(f'thigh{s}', (s * 0.075 * w, 0.03, 0.075), (s * 0.085 * w, 0.30, 0.095), 0.058 * (0.6 + 0.4 * w), 0.05 * (0.6 + 0.4 * w), M['suit'], segs=6), 'spine')
        add(lib.ellipsoid(f'boot{s}', (s * 0.088 * w, 0.36, 0.095), (0.058, 0.085, 0.052), M['suit'], segs=8, rings=5), 'spine')
    for s, side in ((-1, 'L'), (1, 'R')):
        sh = (s * 0.170 * w, 0.00, top - 0.105)
        el = (s * 0.205 * w, 0.130, 0.255)
        wr = (s * 0.105, 0.300, 0.300)
        ar = 0.6 + 0.4 * w
        add(lib.ellipsoid(f'shoulder{side}', sh, (0.058 * ar, 0.058 * ar, 0.058 * ar), M['suit'], segs=8, rings=5), f'upperArm.{side}')
        add(lib.capsule(f'upper{side}', sh, el, 0.050 * ar, 0.045 * ar, M['suit'], segs=8), f'upperArm.{side}')
        add(lib.capsule(f'fore{side}', el, wr, 0.045 * ar, 0.040 * ar, M['suit'], segs=8), f'forearm.{side}')
        add(lib.ellipsoid(f'glove{side}', (s * 0.095, 0.335, 0.300), (0.062, 0.058, 0.060), M['eyes'], segs=10, rings=7), f'hand.{side}')
        add(lib.ellipsoid(f'cuff{side}', (s * 0.108, 0.300, 0.298), (0.050, 0.046, 0.050), M['suit'], segs=8, rings=5), f'forearm.{side}')

    dz = (top - 0.44) - 0.07  # JP's head sits 0.07 lower with torso top 0.44; same contact for every build
    for o, bone in parts:
        if bone == 'head':
            o.location.z += dz
    return c, parts, top, dz


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    pid = argv[0]
    export = '--export' in argv
    c, parts, top, dz = build(pid)
    sc = bpy.context.scene
    sc.render.fps = rig_mod.FPS
    per = sorted(((lib.tri_count(o), o.name) for o, _ in parts), reverse=True)
    print(pid, 'triángulos (sin unir):', sum(t for t, _ in per), per[:6])
    target = (0.0, 0.08, 0.45 + dz * 0.6)
    lib.lights(center=(0, 0.1, 0.5))
    if not export:
        lib.render_views(pid, target=target, radius=2.0)
        return
    bw = BODY[pid]
    rg = rig_mod.make_armature(rig_mod.bone_table(s_x=0.17 * bw['w'], shoulder_z=top - 0.105, elbow=(0.205 * bw['w'], 0.13, 0.255),
                                                  head_z=top + 0.02, top_z=top + 0.45, chest_top=top))
    mesh = rig_mod.skin(parts, rg, pid)
    lod0 = lib.tri_count(mesh)
    lod = rig_mod.make_lod1(mesh, min(1.0, LOD1_TRIS / lod0), pid + '_LOD1')
    lod1 = lib.tri_count(lod)
    for m in (mesh, lod):
        rig_mod.add_armature_modifier(m, rg)
    print(f'{pid} LOD0 {lod0} tris, LOD1 {lod1} tris, materiales {[m.name for m in mesh.data.materials]}')
    clips = rig_mod.driver_clips(rg)
    rig_mod.show(rg, clips['idle'], 1)
    lib.render_views(pid, target=target, radius=2.0)
    if '--poses' in argv:
        for clip, frame in (('steerL', 16), ('trick', 7), ('victory', 9)):
            rig_mod.show(rg, clips[clip], frame)
            lib.render_views(f'{pid}_pose_{clip}', target=target, radius=2.0, views=('34',), size=512, samples=24)
        rig_mod.show(rg, clips['idle'], 1)
    bpy.ops.wm.save_as_mainfile(filepath=lib.safe_path(os.path.join(lib.BLEND_DIR, f'driver_{pid}.blend')))
    for o in list(bpy.data.objects):
        if o.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(o)
    out = lib.export_glb(os.path.join(lib.MODELS_DIR, f'driver_{pid}.glb'))
    print(f'{pid} exportado:', os.path.getsize(out), 'bytes')


main()
