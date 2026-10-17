# Prints the bounding box of every mesh of the given .glb files (units of the file). Run: blender -b --python inspect_glb.py -- a.glb b.glb
import bpy, sys
files = sys.argv[sys.argv.index('--') + 1:]
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            d = o.dimensions
            print('GLB', f.split('/')[-1], o.name, 'dims', round(d.x, 3), round(d.y, 3), round(d.z, 3), 'loc', tuple(round(v, 3) for v in o.location), 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons), 'mats', [m.name for m in o.data.materials])
