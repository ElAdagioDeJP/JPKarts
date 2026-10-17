# Re-imports a driver .glb into an empty scene and prints what a game would see: objects, tris, bones, clips (name, frames, seconds), size.
# Run: blender -b --python art/blender/check_glb.py -- path/to/driver_x.glb
import bpy, sys, os
f = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f)
print('CHECK file', os.path.basename(f), os.path.getsize(f), 'bytes')
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        d = o.dimensions
        me = o.data
        me.calc_loop_triangles()
        print('CHECK mesh', o.name, 'dims(x,y,z)', round(d.x, 3), round(d.y, 3), round(d.z, 3), 'tris', len(me.loop_triangles), 'mats', [m.name for m in me.materials], 'groups', len(o.vertex_groups))
    elif o.type == 'ARMATURE':
        print('CHECK armature', o.name, 'bones', sorted(b.name for b in o.data.bones))
    else:
        print('CHECK other', o.name, o.type)
for a in bpy.data.actions:
    r = a.frame_range
    print('CHECK clip', a.name, 'frames', round(r[0], 2), round(r[1], 2), 'seconds', round((r[1] - r[0]) / bpy.context.scene.render.fps, 3))
