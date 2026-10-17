"""Turntable review: opens art/blender/driver_<id>.blend and renders 8 azimuths + a top view into art/blender/renders/<id>_turn_<n>.png.
Run: blender -b art/blender/driver_jp.blend --python art/blender/render_extra.py -- jp
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import lib

pid = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 640
sc.eevee.taa_render_samples = 32
target, radius = (0.0, 0.08, 0.46), 2.0
views = [(f'az{a:03d}', a, 0.35) for a in range(90, 90 + 360, 45)] + [('top', 90, 1.9)]
for name, az, h in views:
    a = math.radians(az)
    loc = (target[0] + radius * math.cos(a), target[1] + radius * math.sin(a), target[2] + h)
    if name == 'top':
        loc = (0.0, 0.25, 2.6)
    cam = lib.camera(loc, target)
    sc.render.filepath = lib.safe_path(os.path.join(lib.RENDER_DIR, f'{pid}_turn_{name}.png'))
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
