"""JP, the heavy pilot: chibi 3D driver (docs/V3_PLAN.md §4.2). Colours come from packages/core/data/characters.json (JP):
helmet #2f6bff, skin #e0a878, mouth #b8404f, suit = helmet x 0.72, gloves #fff7e0, glasses + irises #20306e.
Build:  blender -b --python art/blender/driver_jp.py            (geometry + review renders)
        blender -b --python art/blender/driver_jp.py -- --export  (adds rig, clips, LOD1 and writes the .glb)
Materials (exactly 6): skin, helmet, suit, hair, eyes, acc.  JP has no hair, so `hair` is the dark-red detail of the mouth.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math
import bpy
from mathutils import Vector
import lib
import rig as rig_mod

ID = 'jp'
COL = dict(skin='#e0a878', helmet='#2f6bff', suit='#224db8', hair='#b8404f', eyes='#fff7e0', acc='#20306e')

# bone of every body part: (name, kind, args) built below
def build():
    lib.reset()
    lib.setup_world()
    M = {k: lib.material(k, v) for k, v in COL.items()}
    parts = []  # (object, bone)

    def add(o, bone):
        parts.append((o, bone))
        return o

    # ---- head: helmet shell + face window, eyes, glasses, mouth (chibi: head ~45 % of the 0.95 m)
    HC = (0.0, 0.0, 0.725)
    FC, FR = (0.0, 0.112, 0.700), (0.168, 0.135, 0.138)   # the face ellipsoid pokes out of the helmet like the pixel portrait's skin oval

    def face_y(x, z, lift=0.0):
        """y of the face surface at (x, z) so details sit exactly on it."""
        t = 1 - (x / FR[0]) ** 2 - ((z - FC[2]) / FR[2]) ** 2
        return FC[1] + FR[1] * (max(t, 0.0) ** 0.5) + lift

    add(lib.ellipsoid('helmet', HC, (0.236, 0.232, 0.224), M['helmet'], segs=24, rings=16), 'head')
    add(lib.ellipsoid('face', FC, FR, M['skin'], segs=20, rings=12), 'head')
    add(lib.ellipsoid('nose', (0.0, face_y(0, 0.682, 0.006), 0.682), (0.017, 0.017, 0.014), M['skin'], segs=8, rings=6), 'head')
    for s in (-1, 1):
        ex, ez = s * 0.066, 0.732
        add(lib.ellipsoid(f'eye{s}', (ex, face_y(ex, ez, 0.002), ez), (0.048, 0.012, 0.062), M['eyes'], segs=12, rings=8), 'head')
        add(lib.ellipsoid(f'iris{s}', (ex, face_y(ex, ez, 0.010), ez - 0.004), (0.031, 0.006, 0.047), M['acc'], segs=8, rings=5), 'head')
        add(lib.ellipsoid(f'glint{s}', (ex - s * 0.011, face_y(ex, ez, 0.017), ez + 0.017), (0.0085, 0.003, 0.011), M['eyes'], segs=6, rings=4), 'head')
        # glasses: thin navy frame rings around the eyes + the temple arm going back along the helmet
        ring = [(ex + 0.060 * math.cos(2 * math.pi * k / 18), face_y(ex + 0.060 * math.cos(2 * math.pi * k / 18), ez + 0.068 * math.sin(2 * math.pi * k / 18), 0.012), ez + 0.068 * math.sin(2 * math.pi * k / 18)) for k in range(19)]
        add(lib.tube(f'frame{s}', ring, 0.0065, M['acc'], sides=4, taper=1.0), 'head')
        add(lib.tube(f'temple{s}', [(s * 0.126, face_y(0.126, ez, 0.012), ez + 0.004), (s * 0.205, 0.060, ez + 0.012), (s * 0.228, -0.040, ez + 0.010)], 0.007, M['acc'], sides=5), 'head')
        add(lib.ellipsoid(f'blush{s}', (s * 0.112, face_y(s * 0.112, 0.668, 0.003), 0.668), (0.022, 0.005, 0.013), M['hair'], segs=8, rings=5), 'head')
    add(lib.tube('bridge', [(-0.030, face_y(0.03, 0.74, 0.024), 0.742), (0.0, face_y(0, 0.745, 0.027), 0.748), (0.030, face_y(0.03, 0.74, 0.024), 0.742)], 0.006, M['acc'], sides=5), 'head')
    # the smile
    smile = [(x * 0.014, face_y(x * 0.014, 0.638 + 0.0022 * x * x, 0.004), 0.638 + 0.0022 * x * x) for x in range(-4, 5)]
    add(lib.tube('mouth', smile, 0.0062, M['hair'], sides=6, taper=0.45), 'head')

    # racing stripes over the helmet (front to back) so the back of the head reads as JP's too
    for x0 in (-0.052, 0.052):
        k = (1 - (x0 / 0.236) ** 2) ** 0.5
        pts = [(x0, 0.232 * k * 0.995 * math.cos(math.radians(t)), 0.725 + 0.224 * k * 0.995 * math.sin(math.radians(t))) for t in range(30, 215, 12)]
        add(lib.tube(f'stripe{x0}', pts, 0.012, M['eyes'], sides=4, taper=0.7), 'head')
    # ---- neck, torso, belt, legs (hidden by the kart tub, but they exist for the podium and the replay camera)
    # no neck mesh: the helmet sits straight on the shoulders (the `neck` bone still exists for the rig)
    add(lib.ellipsoid('torso', (0.0, 0.0, 0.255), (0.165, 0.115, 0.185), M['suit'], segs=16, rings=10), 'chest')
    add(lib.tube('back_stripe', [(0.0, -0.118, 0.40 - 0.03 * i), (0.0, -0.118 - 0.0, 0.40 - 0.03 * i - 0.03)] if False else [(0.0, -0.1135 * (1 - ((0.40 - 0.03 * i - 0.255) / 0.185) ** 2) ** 0.5 - 0.004, 0.40 - 0.03 * i) for i in range(0, 9)], 0.012, M['eyes'], sides=5, taper=0.9), 'chest')
    add(lib.ellipsoid('pelvis', (0.0, -0.01, 0.075), (0.15, 0.115, 0.085), M['suit'], segs=10, rings=6), 'spine')
    add(lib.box('belt', (0.0, 0.0, 0.115), (0.31, 0.24, 0.035), M['acc'], bevel=0.008), 'spine')
    for s in (-1, 1):
        add(lib.capsule(f'thigh{s}', (s * 0.075, 0.03, 0.075), (s * 0.085, 0.30, 0.095), 0.058, 0.05, M['suit'], segs=6), 'spine')
        add(lib.ellipsoid(f'boot{s}', (s * 0.088, 0.36, 0.095), (0.058, 0.085, 0.052), M['suit'], segs=8, rings=5), 'spine')

    # ---- arms: upper arm, forearm, glove on the wheel (hands 0.35 m in front of the chest)
    for s, side in ((-1, 'L'), (1, 'R')):
        sh = (s * 0.170, 0.00, 0.335)
        el = (s * 0.205, 0.130, 0.255)
        wr = (s * 0.105, 0.300, 0.300)
        add(lib.ellipsoid(f'shoulder{side}', sh, (0.058, 0.058, 0.058), M['suit'], segs=8, rings=5), f'upperArm.{side}')
        add(lib.capsule(f'upper{side}', sh, el, 0.050, 0.045, M['suit'], segs=8), f'upperArm.{side}')
        add(lib.capsule(f'fore{side}', el, wr, 0.045, 0.040, M['suit'], segs=8), f'forearm.{side}')
        add(lib.ellipsoid(f'glove{side}', (s * 0.095, 0.335, 0.300), (0.062, 0.058, 0.060), M['eyes'], segs=10, rings=7), f'hand.{side}')
        add(lib.ellipsoid(f'cuff{side}', (s * 0.108, 0.300, 0.298), (0.050, 0.046, 0.050), M['acc'], segs=8, rings=5), f'forearm.{side}')
    for o, bone in parts:
        if bone == 'head':
            o.location.z -= HEAD_DROP
    return M, parts


HEAD_DROP = 0.07  # the head comes down onto the torso (no neck)
TARGET = (0.0, 0.08, 0.45)
LOD1_TRIS = 1400


def main():
    export = '--export' in sys.argv
    M, parts = build()
    sc = bpy.context.scene
    sc.render.fps = rig_mod.FPS
    per = sorted(((lib.tri_count(o), o.name) for o, _ in parts), reverse=True)
    tris = sum(t for t, _ in per)
    print('JP triángulos (sin unir):', tris, 'partes:', per)
    lib.lights(center=(0, 0.1, 0.5))
    if not export:
        lib.render_views('jp', target=TARGET, radius=2.0)
        bpy.ops.wm.save_as_mainfile(filepath=lib.safe_path(os.path.join(lib.BLEND_DIR, 'driver_jp.blend')))
        return

    rig = rig_mod.make_armature(rig_mod.bone_table(head_z=0.46, top_z=0.89))
    mesh = rig_mod.skin(parts, rig, ID)
    lod0 = lib.tri_count(mesh)
    lod = rig_mod.make_lod1(mesh, LOD1_TRIS / lod0, ID + '_LOD1')
    lod1 = lib.tri_count(lod)
    for m in (mesh, lod):
        rig_mod.add_armature_modifier(m, rig)
    print(f'JP LOD0 {lod0} tris, LOD1 {lod1} tris, materiales {[m.name for m in mesh.data.materials]}')
    clips = rig_mod.driver_clips(rig)
    rig_mod.show(rig, clips['idle'], 1)
    lib.render_views('jp', target=TARGET, radius=2.0)
    # pose reviews: one frame of the clips that are hard to judge from the numbers
    for clip, frame in (('steerL', 16), ('steerR', 16), ('trick', 7), ('lookBack', 13), ('hit', 5), ('victory', 9)):
        rig_mod.show(rig, clips[clip], frame)
        lib.render_views(f'jp_pose_{clip}', target=TARGET, radius=2.0, views=('34', 'front'), size=640, samples=24)
    rig_mod.show(rig, clips['idle'], 1)
    bpy.ops.wm.save_as_mainfile(filepath=lib.safe_path(os.path.join(lib.BLEND_DIR, 'driver_jp.blend')))
    for o in list(bpy.data.objects):
        if o.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(o)
    out = lib.export_glb(os.path.join(lib.MODELS_DIR, 'driver_jp.glb'))
    print('JP exportado:', out, os.path.getsize(out), 'bytes')


main()
