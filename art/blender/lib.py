"""Helpers shared by the JP Kart Blender scripts (docs/V3_PLAN.md §4). Run with:
    blender -b --python art/blender/<script>.py
Safety (§4.1): scripts only write under art/blender/ and packages/client/src/assets/models/ and never use the network.
Frame of the models: 1 unit = 1 m, +Z up, the model FACES +Y (exports as glTF -Z, which world3d turns into the game's +X).
"""
import math
import os
import bpy
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLEND_DIR = os.path.join(ROOT, 'art', 'blender')
RENDER_DIR = os.path.join(BLEND_DIR, 'renders')
MODELS_DIR = os.path.join(ROOT, 'packages', 'client', 'src', 'assets', 'models')


def safe_path(p):
    """Refuse to write anywhere but the two allowed folders."""
    p = os.path.abspath(p)
    if not (p.startswith(BLEND_DIR) or p.startswith(os.path.abspath(MODELS_DIR))):
        raise RuntimeError('ruta fuera de art/blender y assets/models: ' + p)
    return p


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, hexcol, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    r, g, bl = [srgb_to_linear(c) for c in hex_rgb(hexcol)]
    b.inputs['Base Color'].default_value = (r, g, bl, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = (r, g, bl, 1)
    return m


def _finish(obj, mat, smooth=True):
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def ellipsoid(name, center, radii, mat, segs=24, rings=14, rot=(0, 0, 0)):
    """UV sphere stretched to `radii` (rx, ry, rz) centred on `center` (m)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co.x *= radii[0]; v.co.y *= radii[1]; v.co.z *= radii[2]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler = Euler(rot)
    obj.location = center
    return _finish(obj, mat)


def clamp_z(obj, lo=None, hi=None):
    """Flattens the mesh of `obj` (local Z) at lo / hi: a dome or a chin cap from a whole ellipsoid (the cut stays closed)."""
    for v in obj.data.vertices:
        if lo is not None and v.co.z < lo:
            v.co.z = lo
        if hi is not None and v.co.z > hi:
            v.co.z = hi
    obj.data.update()
    return obj


def capsule(name, p0, p1, r0, r1, mat, segs=10):
    """A tapered capsule from p0 to p1 (radius r0 -> r1), built from a cylinder + two end spheres merged into one mesh."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r0, radius2=r1, depth=length)
    # spheres at the ends
    for pos, r in ((Vector((0, 0, -length / 2)), r0), (Vector((0, 0, length / 2)), r1)):
        sp = bmesh.new()
        bmesh.ops.create_uvsphere(sp, u_segments=segs, v_segments=6, radius=r * 0.97)  # a hair smaller than the cone so the two surfaces never z-fight
        for v in sp.verts:
            v.co += pos
        tmp = bpy.data.meshes.new('tmp')
        sp.to_mesh(tmp); sp.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.location = (p0 + p1) / 2
    obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return _finish(obj, mat)


def box(name, center, size, mat, bevel=0.0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.location = center
    obj.rotation_euler = Euler(rot)
    return _finish(obj, mat)


def tube(name, points, radius, mat, sides=6, taper=0.6):
    """A thin tube along a polyline (mouths, brows, temples). `taper`: radius at the ends relative to the middle."""
    bm = bmesh.new()
    rings = []
    n = len(points)
    for i, p in enumerate(points):
        p = Vector(p)
        t = (points[min(i + 1, n - 1)] if i < n - 1 else points[i])
        prev = points[max(i - 1, 0)]
        tang = (Vector(t) - Vector(prev)).normalized()
        side = tang.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = tang.cross(Vector((1, 0, 0)))
        side.normalize()
        up = tang.cross(side).normalized()
        k = 1.0 - (1.0 - taper) * abs((i / (n - 1)) * 2 - 1) ** 2
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            ring.append(bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * radius * k))
        rings.append(ring)
    for i in range(n - 1):
        for j in range(sides):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]))
    bmesh.ops.contextual_create(bm, geom=rings[0])
    bmesh.ops.contextual_create(bm, geom=rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return _finish(obj, mat)


def cylinder(name, p0, p1, r, mat, segs=12, r1=None, caps=True):
    """Straight (optionally tapered, r -> r1) cylinder from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r, radius2=r if r1 is None else r1, depth=d.length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.location = (p0 + p1) / 2
    obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    _finish(obj, mat, smooth=False)
    for p in me.polygons:  # smooth round the barrel, flat caps
        p.use_smooth = abs(p.normal.z) < 0.5
    return obj


def prism(name, pts, dz, mat, smooth=False):
    """Flat panel: the outline `pts` (star-shaped around its centroid) thickened by +-dz in Z. Used for wing canvas."""
    bm = bmesh.new()
    c = sum((Vector(p) for p in pts), Vector()) / len(pts)
    top = [bm.verts.new((p[0], p[1], p[2] + dz)) for p in pts]
    bot = [bm.verts.new((p[0], p[1], p[2] - dz)) for p in pts]
    ct, cb = bm.verts.new((c.x, c.y, c.z + dz)), bm.verts.new((c.x, c.y, c.z - dz))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ct, top[i], top[j]))
        bm.faces.new((cb, bot[j], bot[i]))
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return _finish(obj, mat, smooth=smooth)


def empty(name, loc):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = 'PLAIN_AXES'
    o.location = loc
    bpy.context.collection.objects.link(o)
    return o


def render_cams(prefix, target, cams, size=512, samples=32):
    """cams: [(name, azimuth deg, elevation m, radius m)] -> renders/<prefix>_<name>.png. 'top' = straight down."""
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.eevee.taa_render_samples = samples
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    for name, az, el, rad in cams:
        a = math.radians(az)
        loc = (target[0] + rad * math.cos(a), target[1] + rad * math.sin(a), target[2] + el)
        if name == 'top':
            loc = (target[0], target[1] + 0.01, target[2] + rad)
        cam = camera(loc, target)
        sc.render.filepath = safe_path(os.path.join(RENDER_DIR, f'{prefix}_{name}.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def apply_transforms(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    j.data.name = name
    return j


# ------------------------------------------------------------------ rendering
def setup_world(bg=(0.42, 0.42, 0.44)):
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    n = sc.world.node_tree.nodes['Background']
    n.inputs['Color'].default_value = (*bg, 1)
    n.inputs['Strength'].default_value = 1.0


def lights(center=(0, 0.1, 0.5), dist=2.2):
    """3-point lighting: key, fill, rim (area lights)."""
    c = Vector(center)
    for name, pos, energy, col in (
        ('key', (1.6, 1.8, 1.9), 220, (1, 0.97, 0.92)),
        ('fill', (-2.0, 1.2, 0.8), 90, (0.85, 0.9, 1)),
        ('rim', (0.2, -2.2, 1.7), 150, (1, 1, 1)),
    ):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy = energy; ld.size = 1.6; ld.color = col
        lo = bpy.data.objects.new(name, ld)
        lo.location = Vector(pos) + c * 0
        bpy.context.collection.objects.link(lo)
        d = c - lo.location
        lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, look_at, lens=65):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    co = bpy.data.objects.new('cam', cd)
    co.location = loc
    bpy.context.collection.objects.link(co)
    co.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co


def render_views(prefix, target=(0, 0.1, 0.5), radius=2.3, size=1024, views=('front', 'back', '34', 'side'), samples=48):
    """Renders the model from the four review views into art/blender/renders/<prefix>_<view>.png (Eevee)."""
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.eevee.taa_render_samples = samples
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    ang = {'front': 90, 'back': -90, '34': 55, 'side': 0}  # azimuth around +Z; the model faces +Y so 'front' is the camera on +Y
    out = []
    for v in views:
        a = math.radians(ang[v])
        loc = (target[0] + radius * math.cos(a), target[1] + radius * math.sin(a), target[2] + 0.35)
        cam = camera(loc, target)
        sc.render.filepath = safe_path(os.path.join(RENDER_DIR, f'{prefix}_{v}.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)
        out.append(sc.render.filepath)
    return out


def export_glb(path, objs_names=None, animations=True):
    path = safe_path(path)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_apply=True, export_animations=animations,
        export_animation_mode='ACTIONS', export_frame_step=2, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=False, export_yup=True, export_cameras=False, export_lights=False, export_skins=True,
    )
    return path
