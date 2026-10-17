"""Assembly check: every chassis with 4 standard wheels on its wheel_* empties and JP (driver_jp.glb) on its `seat` empty.
Run: blender -b --python art/blender/assemble.py -- [kernel,overdrive,...] [--wheel=std] [--wing=wing]   -> renders/kart_<id>_<view>.png
Reads the parts straight from parts.py (not from the .glb) so it works before exporting; JP comes from the exported .glb."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import lib
import parts

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = next((a.split(',') for a in argv if not a.startswith('--')), list(parts.CHASSIS))
wheel = next((a[8:] for a in argv if a.startswith('--wheel=')), 'std')
wing = next((a[7:] for a in argv if a.startswith('--wing=')), None)


def place(objs, name, loc):
    for o in objs:
        lib.apply_transforms(o)
    m = lib.join(objs, name)
    m.location = loc
    return m


for pid in ids:
    lib.reset()
    lib.setup_world()
    M = parts.mats()
    chassis, emps = parts.CHASSIS[pid](M)
    for o in chassis:
        lib.apply_transforms(o)
    body = lib.join(chassis, 'kart_' + pid)
    for n in ('wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'):
        place(parts.WHEELS[wheel](M), n, emps[n])
    if wing:
        place(parts.WINGS[wing](M), 'wing', emps['glider'])
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(lib.MODELS_DIR, 'driver_jp.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    junk = [o for o in new if o.name.startswith('Icosphere') or o.name.endswith('_LOD1')]
    keep = [o for o in new if o not in junk]
    for o in junk:
        bpy.data.objects.remove(o)
    for o in keep:
        if o.parent is None:
            o.location = emps['seat']
    lib.lights(center=(0, 0, 0.5), dist=3)
    lib.box('ground', (0, 0, -0.01), (5, 5, 0.02), lib.material('gnd', '#55585f'))
    top = 0.55 if pid != 'rover' else 0.75
    lib.render_cams('kart_' + pid, (0, 0, top), [('f34', 55, 0.7, 4.0), ('b34', -125, 0.7, 4.0), ('side', 0, 0.2, 4.2), ('top', 90, 0, 4.6)], size=512)
    print('ASSEMBLED', pid)
