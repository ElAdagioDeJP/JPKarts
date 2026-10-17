"""Kart parts (docs/V3_PLAN.md §2.4, §4.3): 4 chassis, 4 wheels, 3 wings -> packages/client/src/assets/models/part_<id>.glb,
review renders in art/blender/renders/part_<id>_<view>.png, source art/blender/parts.blend (all parts laid out in a row).
Run: blender -b --python art/blender/parts.py -- [--export] [--only=kernel,std]
Frame: 1 unit = 1 m, +Z up, the kart FACES +Y (glTF -Z, world3d turns it into the game's +X). Wheels spin about X.
Chassis carry the empties `seat`, `wheel_FL/FR/RL/RR`, `glider`; the `body`/`canvas` material is white in the .glb (the game tints it)
and orange in the review renders.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import lib

TINT = '#ff8a1f'  # JP's kart colour, only for the review renders
DEG = math.radians


def mats(tint=TINT):
    return dict(body=lib.material('body', tint), canvas=lib.material('canvas', tint), trim=lib.material('trim', '#2b2f3a'),
                seat=lib.material('seat', '#7a1f2b'), metal=lib.material('metal', '#9aa1b3', rough=0.5),
                tire=lib.material('tire', '#1a1a22', rough=0.9), rim=lib.material('rim', '#c8ccd8', rough=0.4),
                frame=lib.material('frame', '#9aa1b3', rough=0.5))


def seat_parts(M, y, z, w=0.36):
    """Bucket seat: pan + back. `z` = height of the seat surface (where the pilot's origin sits)."""
    return [lib.box('seat_pan', (0, y, z - 0.04), (w, 0.32, 0.08), M['seat'], bevel=0.015),
            lib.box('seat_back', (0, y - 0.17, z + 0.17), (w + 0.04, 0.07, 0.36), M['seat'], bevel=0.02, rot=(DEG(-8), 0, 0))]


def steering(M, seat_y, seat_z):
    """Wheel + column where the pilot's hands are (0.335 m in front of the seat origin, 0.30 above it)."""
    y, z = seat_y + 0.335, seat_z + 0.30
    ring = [(0.11 * math.cos(2 * math.pi * i / 20), y + 0.025 * math.sin(2 * math.pi * i / 20), z + 0.11 * math.sin(2 * math.pi * i / 20)) for i in range(21)]
    return [lib.tube('steer_ring', ring, 0.014, M['trim'], sides=5, taper=1.0),
            lib.cylinder('steer_col', (0, y + 0.01, z - 0.02), (0, y + 0.14, z - 0.28), 0.017, M['metal'], segs=6)]


def axle(M, y, x, z, r=0.02):
    return lib.cylinder(f'axle{y}', (-x, y, z), (x, y, z), r, M['metal'], segs=6)


def emp(seat, fy, ry, tx, z, glider):
    return dict(seat=seat, wheel_FL=(-tx, fy, z), wheel_FR=(tx, fy, z), wheel_RL=(-tx, ry, z), wheel_RR=(tx, ry, z), glider=glider)


# ------------------------------------------------------------------ chassis (return meshes + empties)
def kernel(M):
    o = [lib.box('floor', (0, 0, 0.12), (0.72, 1.30, 0.06), M['body'], bevel=0.012),
         lib.ellipsoid('nose', (0, 0.58, 0.20), (0.30, 0.34, 0.11), M['body'], segs=14, rings=8),
         lib.ellipsoid('stripe', (0, 0.60, 0.295), (0.06, 0.26, 0.025), M['trim'], segs=8, rings=5),
         lib.cylinder('bumper', (-0.30, 0.90, 0.17), (0.30, 0.90, 0.17), 0.03, M['metal'], segs=8),
         lib.box('dash', (0, 0.30, 0.30), (0.40, 0.20, 0.06), M['body'], bevel=0.015),
         lib.box('engine', (0, -0.50, 0.26), (0.46, 0.22, 0.22), M['metal'], bevel=0.02),
         lib.box('spoiler', (0, -0.68, 0.56), (0.70, 0.12, 0.03), M['body'], bevel=0.008),
         axle(M, 0.50, 0.45, 0.21), axle(M, -0.50, 0.45, 0.21)]
    for s in (-1, 1):
        o += [lib.ellipsoid(f'pod{s}', (s * 0.27, 0.05, 0.22), (0.11, 0.52, 0.10), M['body'], segs=12, rings=7),
              lib.ellipsoid(f'fender_f{s}', (s * 0.45, 0.50, 0.40), (0.12, 0.20, 0.04), M['body'], segs=10, rings=5),
              lib.ellipsoid(f'fender_r{s}', (s * 0.45, -0.50, 0.40), (0.12, 0.20, 0.04), M['body'], segs=10, rings=5),
              lib.cylinder(f'exhaust{s}', (s * 0.12, -0.62, 0.22), (s * 0.12, -0.80, 0.22), 0.04, M['metal'], segs=8),
              lib.box(f'strut{s}', (s * 0.27, -0.64, 0.42), (0.03, 0.03, 0.28), M['trim'])]
    o += seat_parts(M, -0.15, 0.26) + steering(M, -0.15, 0.26)
    return o, emp((0, -0.15, 0.26), 0.50, -0.50, 0.45, 0.21, (0, -0.50, 0.50))


def overdrive(M):
    o = [lib.box('floor', (0, 0, 0.10), (0.62, 1.55, 0.05), M['body'], bevel=0.01),
         lib.ellipsoid('hull', (0, 0.12, 0.18), (0.30, 0.82, 0.10), M['body'], segs=24, rings=12),
         lib.ellipsoid('beak', (0, 0.82, 0.14), (0.15, 0.32, 0.065), M['body'], segs=16, rings=8),
         lib.box('splitter', (0, 0.94, 0.085), (0.64, 0.22, 0.02), M['trim'], bevel=0.005),
         lib.box('fin', (0, -0.42, 0.38), (0.03, 0.46, 0.20), M['body'], bevel=0.006),
         lib.box('wing', (0, -0.76, 0.58), (0.82, 0.20, 0.03), M['body'], bevel=0.008),
         lib.box('engine', (0, -0.46, 0.22), (0.34, 0.24, 0.16), M['metal'], bevel=0.02),
         axle(M, 0.58, 0.43, 0.21), axle(M, -0.55, 0.43, 0.21)]
    for s in (-1, 1):
        o += [lib.box(f'plate{s}', (s * 0.41, -0.76, 0.52), (0.03, 0.24, 0.17), M['trim'], bevel=0.004),
              lib.box(f'wstrut{s}', (s * 0.20, -0.70, 0.40), (0.03, 0.03, 0.30), M['metal']),
              lib.box(f'intake{s}', (s * 0.30, 0.15, 0.20), (0.05, 0.26, 0.07), M['trim'], bevel=0.008),
              lib.ellipsoid(f'pod{s}', (s * 0.29, 0.0, 0.17), (0.09, 0.50, 0.07), M['body'], segs=16, rings=8)]
    o += seat_parts(M, -0.12, 0.19, w=0.34) + steering(M, -0.12, 0.19)
    return o, emp((0, -0.12, 0.19), 0.58, -0.55, 0.43, 0.21, (0, -0.55, 0.58))


def mainframe(M):
    o = [lib.box('floor', (0, 0, 0.13), (0.92, 1.25, 0.08), M['body'], bevel=0.015),
         lib.box('rack', (0, -0.47, 0.44), (0.76, 0.46, 0.60), M['body'], bevel=0.02),
         lib.box('hood', (0, 0.50, 0.27), (0.72, 0.52, 0.20), M['body'], bevel=0.02),
         lib.box('bumper', (0, 0.84, 0.19), (0.92, 0.12, 0.14), M['metal'], bevel=0.02),
         lib.box('led', (0, 0.905, 0.27), (0.64, 0.02, 0.03), M['trim']),
         lib.box('dash', (0, 0.28, 0.32), (0.46, 0.20, 0.06), M['body'], bevel=0.015),
         lib.box('roof', (0, -0.47, 0.76), (0.70, 0.40, 0.03), M['trim'], bevel=0.005),
         axle(M, 0.52, 0.52, 0.21, 0.025), axle(M, -0.50, 0.52, 0.21, 0.025)]
    for s in (-1, 1):
        o += [lib.box(f'wall{s}', (s * 0.40, 0.0, 0.30), (0.10, 0.72, 0.22), M['body'], bevel=0.015),
              lib.box(f'side_vent{s}', (s * 0.46, -0.47, 0.44), (0.02, 0.34, 0.30), M['trim'])]
    for s in (-1, 1):
        o += [lib.cylinder(f'lamp{s}', (s * 0.26, 0.76, 0.30), (s * 0.26, 0.80, 0.30), 0.055, M['trim'], segs=14),
              lib.cylinder(f'stack{s}', (s * 0.31, -0.62, 0.70), (s * 0.31, -0.62, 1.02), 0.04, M['metal'], segs=12),
              lib.cylinder(f'stack_cap{s}', (s * 0.31, -0.62, 1.02), (s * 0.31, -0.62, 1.05), 0.055, M['trim'], segs=12)]
    o.append(lib.cylinder('antenna', (0.0, -0.70, 0.76), (0.0, -0.70, 1.20), 0.008, M['metal'], segs=6))
    for i in range(6):  # rack units on the rear face and vent slits on the hood
        o.append(lib.box(f'unit{i}', (0, -0.705, 0.24 + i * 0.085), (0.62, 0.015, 0.035), M['trim']))
    for i in range(4):
        o.append(lib.box(f'slit{i}', (-0.21 + i * 0.14, 0.50, 0.375), (0.09, 0.30, 0.012), M['trim']))
    o += seat_parts(M, 0.0, 0.30, w=0.34) + steering(M, 0.0, 0.30)
    return o, emp((0, 0.0, 0.30), 0.52, -0.50, 0.52, 0.21, (0, -0.60, 0.80))


def rover(M):
    sz = 0.45
    o = [lib.box('floor', (0, 0, 0.30), (0.62, 1.20, 0.05), M['body'], bevel=0.01),
         lib.box('skid', (0, 0.05, 0.255), (0.50, 0.90, 0.03), M['metal'], bevel=0.008),
         lib.ellipsoid('nose', (0, 0.52, 0.40), (0.26, 0.32, 0.12), M['body'], segs=12, rings=7),
         lib.box('engine', (0, -0.48, 0.44), (0.42, 0.26, 0.24), M['metal'], bevel=0.02),
         lib.box('dash', (0, 0.18, 0.54), (0.40, 0.18, 0.06), M['body'], bevel=0.012),
         lib.box('lightbar', (0, 0.30, 1.00), (0.56, 0.05, 0.06), M['trim'], bevel=0.008),
         axle(M, 0.52, 0.45, 0.25, 0.015), axle(M, -0.50, 0.45, 0.25, 0.015)]
    for s in (-1, 1):
        for y in (0.52, -0.50):
            o += [lib.cylinder(f'arm{s}{y}', (s * 0.22, y, 0.30), (s * 0.45, y, 0.25), 0.018, M['metal'], segs=6),
                  lib.cylinder(f'shock{s}{y}', (s * 0.40, y, 0.27), (s * 0.30, y, 0.58), 0.022, M['trim'], segs=6)]
        # roll cage: rear hoop, front hoop, roof rails
        o += [lib.tube(f'hoop_r{s}', [(s * 0.30, -0.30, 0.33), (s * 0.30, -0.30, 1.40)], 0.022, M['metal'], sides=8, taper=1.0),
              lib.tube(f'hoop_f{s}', [(s * 0.29, 0.44, 0.36), (s * 0.29, 0.34, 0.97)], 0.022, M['metal'], sides=8, taper=1.0),
              lib.tube(f'rail{s}', [(s * 0.29, 0.34, 0.97), (s * 0.30, -0.30, 1.40)], 0.022, M['metal'], sides=8, taper=1.0),
              lib.tube(f'brace{s}', [(s * 0.30, -0.30, 0.70), (s * 0.30, -0.50, 0.40)], 0.018, M['metal'], sides=8, taper=1.0)]
    o += [lib.tube('hoop_top_r', [(-0.30, -0.30, 1.40), (0.30, -0.30, 1.40)], 0.022, M['metal'], sides=8, taper=1.0),
          lib.tube('hoop_top_f', [(-0.29, 0.34, 0.97), (0.29, 0.34, 0.97)], 0.022, M['metal'], sides=8, taper=1.0)]
    for s in (-1, 1):
        o += [lib.cylinder(f'spot{s}', (s * 0.16, 0.33, 1.00), (s * 0.16, 0.38, 1.00), 0.055, M['body'], segs=14)]
    o += seat_parts(M, -0.10, sz) + steering(M, -0.10, sz)
    return o, emp((0, -0.10, sz), 0.52, -0.50, 0.45, 0.25, (0, -0.42, 1.38))


CHASSIS = dict(kernel=kernel, overdrive=overdrive, mainframe=mainframe, rover=rover)


# ------------------------------------------------------------------ wheels (axis X, centred)
def tyre(M, R, w, segs=20, lugs=0, lug_h=0.03, spokes=0, rim_k=0.62):
    o = []
    t = lib.cylinder('tyre', (-w / 2, 0, 0), (w / 2, 0, 0), R, M['tire'], segs=segs)
    o.append(t)
    o.append(lib.cylinder('rim', (-w / 2 - 0.012, 0, 0), (w / 2 + 0.012, 0, 0), R * rim_k, M['rim'], segs=segs))
    o.append(lib.cylinder('hub', (-w / 2 - 0.03, 0, 0), (w / 2 + 0.03, 0, 0), R * 0.2, M['rim'], segs=8))
    for i in range(lugs):
        a = 2 * math.pi * i / lugs
        o.append(lib.box(f'lug{i}', (0, (R + lug_h / 2 - 0.004) * math.cos(a), (R + lug_h / 2 - 0.004) * math.sin(a)), (w * 0.96, 0.05, lug_h), M['tire'], rot=(a - math.pi / 2, 0, 0)))
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        o.append(lib.box(f'spoke{i}', (w / 2 + 0.016, 0.5 * R * rim_k * math.cos(a), 0.5 * R * rim_k * math.sin(a)), (0.012, 0.03, R * rim_k * 0.9), M['trim'], rot=(a - math.pi / 2, 0, 0)))
    return o


def wheel_std(M): return tyre(M, 0.21, 0.18)
def wheel_slick(M): return tyre(M, 0.22, 0.27, segs=24, spokes=5, rim_k=0.66)
def wheel_offroad(M): return tyre(M, 0.235, 0.20, segs=16, lugs=14, lug_h=0.03, rim_k=0.55)
def wheel_mini(M): return tyre(M, 0.15, 0.14, segs=14, rim_k=0.6)


WHEELS = dict(std=wheel_std, slick=wheel_slick, offroad=wheel_offroad, mini=wheel_mini)


# ------------------------------------------------------------------ wings (open delta, origin = anchor under the keel)
def delta(M, half, apex, tip, notch, rise, z0=0.55, kite=False):
    A = (0, apex, z0 + 0.03)
    TL, TR = (-half, tip, z0 + rise), (half, tip, z0 + rise)
    N = (0, notch, z0)
    o = [lib.prism('canvas_l', [A, TL, N], 0.006, M['canvas']), lib.prism('canvas_r', [A, N, TR], 0.006, M['canvas'])]
    r = 0.022
    for name, p, q in (('edge_l', A, TL), ('edge_r', A, TR), ('keel', A, N), ('batten_l', TL, N), ('batten_r', N, TR)):
        o.append(lib.cylinder(name, p, q, r if 'edge' in name or name == 'keel' else 0.012, M['frame'], segs=6))
    for s in (-1, 1):  # A-frame down to the anchor
        o.append(lib.cylinder(f'leg{s}', (s * 0.12, -0.04, 0.0), (0, (apex + notch) / 2, z0), 0.016, M['frame'], segs=6))
    if kite:  # cross spar of the kite wing
        o.append(lib.cylinder('spar', TL, TR, 0.014, M['frame'], segs=6))
    return o


def wing_std(M): return delta(M, 1.10, 0.80, -0.55, -0.20, 0.16)
def wing_glider(M): return delta(M, 1.50, 0.75, -0.40, -0.52, 0.10)
def wing_light(M): return delta(M, 0.80, 0.55, -0.20, -0.50, 0.14, kite=True)


WINGS = dict(wing=wing_std, glider=wing_glider, light=wing_light)

# part id -> (kind, builder, review views)
ALL = {**{k: ('chassis', f) for k, f in CHASSIS.items()}, **{k: ('wheel', f) for k, f in WHEELS.items()}, **{k: ('wing', f) for k, f in WINGS.items()}}
VIEWS = {
    'chassis': ((0.0, 0.0, 0.45), [('f34', 55, 0.6, 2.6), ('b34', -125, 0.6, 2.6), ('side', 0, 0.3, 2.8), ('top', 90, 0, 3.2)]),
    'wheel': ((0.0, 0.0, 0.0), [('f34', 40, 0.25, 1.1), ('side', 0, 0.0, 1.2), ('front', 90, 0.0, 1.2)]),
    'wing': ((0.0, 0.0, 0.5), [('f34', 55, 0.9, 5.0), ('b34', -125, 0.9, 5.0), ('top', 90, 0, 5.2)]),
}


def build(pid, tint=TINT):
    kind, fn = ALL[pid]
    M = mats(tint)
    objs, emps = (fn(M) if kind == 'chassis' else (fn(M), None))
    for o in objs:
        lib.apply_transforms(o)
    mesh = lib.join(objs, f'part_{pid}')
    out = [mesh]
    if emps:
        out += [lib.empty(n, v) for n, v in emps.items()]
    return mesh, out


def set_tint(white=True):
    for m in bpy.data.materials:
        if m.name.split('.')[0] in ('body', 'canvas'):
            col = (1, 1, 1, 1) if white else (*[lib.srgb_to_linear(c) for c in lib.hex_rgb(TINT)], 1)
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = col
            m.diffuse_color = col


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    export = '--export' in argv
    only = next((a[7:].split(',') for a in argv if a.startswith('--only=')), list(ALL))
    sizes = {}
    for pid in only:
        lib.reset()
        lib.setup_world()
        sc = bpy.context.scene
        mesh, out = build(pid)
        kind = ALL[pid][0]
        tris = lib.tri_count(mesh)
        dims = tuple(round(v, 3) for v in mesh.dimensions)
        lib.lights(center=(0, 0, 0.4), dist=3)
        if kind == 'chassis':  # a dark ground to judge wheel height
            g = lib.box('ground', (0, 0, -0.01), (4, 4, 0.02), lib.material('gnd', '#55585f'))
        target, cams = VIEWS[kind]
        lib.render_cams(f'part_{pid}', target, cams, size=512)
        for o in list(bpy.data.objects):
            if o.type in ('LIGHT', 'CAMERA') or o.name == 'ground':
                bpy.data.objects.remove(o)
        set_tint(white=True)
        path = os.path.join(lib.MODELS_DIR, f'part_{pid}.glb')
        if export:
            bpy.ops.export_scene.gltf(filepath=lib.safe_path(path), export_format='GLB', export_apply=True, export_animations=False,
                                      export_yup=True, export_cameras=False, export_lights=False)
            sizes[pid] = os.path.getsize(path)
        print(f'PART {pid} {kind} tris={tris} dims={dims} mats={[m.name for m in mesh.data.materials]} kb={sizes.get(pid, 0) / 1024:.1f}')
    return


def layout():
    if True:
        lib.reset()
        x = 0.0
        for pid in ALL:
            mesh, out = build(pid)
            w = max(mesh.dimensions.x, 0.5) + 0.4
            for o in out:
                o.location.x += x
            x += w
        bpy.ops.wm.save_as_mainfile(filepath=lib.safe_path(os.path.join(lib.BLEND_DIR, 'parts.blend')))


if __name__ == '__main__':
    if '--layout' in sys.argv:
        layout()
    else:
        main()
