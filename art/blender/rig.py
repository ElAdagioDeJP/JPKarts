"""Rig + clips shared by every driver_<id>.py (docs/V3_PLAN.md §4.2, §4.4 step 3).
Frame of the model: 1 unit = 1 m, +Z up, faces +Y, +X is the pilot's right, 'L' bones live at -X.
Pose helpers take rotations in ARMATURE axes (degrees, Euler XYZ) and convert them to each bone's rest frame, so
"X +20" always means "pitch the part up/back about the model's X axis" no matter how the bone was rolled.
"""
import math
import bpy
from mathutils import Euler, Vector
import lib

FPS = 30
BONE_NAMES = ['root', 'spine', 'chest', 'neck', 'head',
              'upperArm.L', 'forearm.L', 'hand.L', 'upperArm.R', 'forearm.R', 'hand.R']


def bone_table(s_x=0.17, shoulder_z=0.335, elbow=(0.205, 0.13, 0.255), wrist=(0.105, 0.30, 0.30), hand_tip=(0.095, 0.40, 0.30),
               head_z=0.53, top_z=0.95):
    """(name, parent, head, tail) for the 11 mandatory bones. Arms follow the shoulder/elbow/wrist points of the model."""
    rows = [
        ('root', None, (0, 0, 0), (0, 0, 0.08)),
        ('spine', 'root', (0, 0, 0.08), (0, 0, 0.20)),
        ('chest', 'spine', (0, 0, 0.20), (0, 0, 0.42)),
        ('neck', 'chest', (0, 0, 0.42), (0, 0, head_z)),
        ('head', 'neck', (0, 0, head_z), (0, 0, top_z)),
    ]
    for s, side in ((-1, 'L'), (1, 'R')):
        sh = (s * s_x, 0.0, shoulder_z)
        el = (s * elbow[0], elbow[1], elbow[2])
        wr = (s * wrist[0], wrist[1], wrist[2])
        tip = (s * hand_tip[0], hand_tip[1], hand_tip[2])
        rows += [(f'upperArm.{side}', 'chest', sh, el), (f'forearm.{side}', f'upperArm.{side}', el, wr), (f'hand.{side}', f'forearm.{side}', wr, tip)]
    return rows


def make_armature(rows, name='rig'):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, parent, head, tail in rows:
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = head, tail
        if parent:
            eb.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def skin(parts, rig, name):
    """parts: [(object, bone)]. Rigid skin (1 part = 1 bone, weight 1), joined into one mesh named `name`, parented to the rig."""
    for o, bone in parts:
        lib.apply_transforms(o)
        vg = o.vertex_groups.new(name=bone)
        vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    mesh = lib.join([o for o, _ in parts], name)
    mesh.parent = rig
    return mesh


def add_armature_modifier(mesh, rig):
    m = mesh.modifiers.new('rig', 'ARMATURE')
    m.object = rig
    mesh.parent = rig


def make_lod1(mesh, ratio, name):
    """Decimated copy (vertex groups survive the collapse). Decimate is applied BEFORE the armature modifier is added."""
    lod = mesh.copy()
    lod.data = mesh.data.copy()
    lod.name = name
    lod.data.name = name
    bpy.context.collection.objects.link(lod)
    bpy.ops.object.select_all(action='DESELECT')
    lod.select_set(True)
    bpy.context.view_layer.objects.active = lod
    mod = lod.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier='dec')
    lod.data.validate(verbose=True)
    lod.data.update()
    return lod


# ------------------------------------------------------------------ poses and clips
def _rest(rig, bone):
    return rig.data.bones[bone].matrix_local.to_3x3()


def set_pose(rig, bone, rot=(0, 0, 0), loc=(0, 0, 0)):
    pb = rig.pose.bones[bone]
    rest = _rest(rig, bone)
    r = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (rest.inverted() @ r @ rest).to_quaternion()
    pb.location = rest.inverted() @ Vector(loc)


def key_pose(rig, pose, frame):
    """pose: {bone: (rot_deg, loc)} (missing bones go to rest). Keys every bone so clips never leak into each other."""
    for b in BONE_NAMES:
        rot, loc = pose.get(b, ((0, 0, 0), (0, 0, 0)))
        set_pose(rig, b, rot, loc)
        pb = rig.pose.bones[b]
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if b in ('root', 'spine', 'chest'):
            pb.keyframe_insert('location', frame=frame)


def new_action(rig, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not rig.animation_data:
        rig.animation_data_create()
    rig.animation_data.action = act
    return act


def build_clip(rig, name, keys, frames):
    """keys: [(frame offset, pose)] with offsets in 0..frames; the clip runs 1..frames+1 (= frames/30 s)."""
    act = new_action(rig, name)
    for off, pose in keys:
        key_pose(rig, pose, 1 + off)
    act.frame_range = (1, 1 + frames)
    return act


def show(rig, act, frame):
    """Poses the rig as `act` at `frame` (for review renders)."""
    rig.animation_data.action = act
    if hasattr(rig.animation_data, 'action_slot') and act.slots:
        rig.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def P(**kw):
    """P(chest=((rx,ry,rz),(x,y,z)), ...) with bone names where '_' stands for '.' (upperArm_L)."""
    return {k.replace('_', '.'): v for k, v in kw.items()}


def R(x=0, y=0, z=0, loc=(0, 0, 0)):
    return ((x, y, z), loc)


def driver_clips(rig):
    """The 7 mandatory clips. Poses are relative to the rest pose (hands on an imaginary wheel)."""
    clips = {}
    idle_a = P(chest=R(1.2, 0, 0, (0, 0, 0.004)), head=R(-1.0, 0, 1.5), upperArm_L=R(1.5), upperArm_R=R(1.5))
    idle_b = P(chest=R(-0.8, 1.2, 0), head=R(0.8, 0, -1.5), spine=R(0, 0, 0, (0, 0, -0.002)))
    idle_c = P(chest=R(0.4, -1.2, 0), head=R(0, 0, 1.0))
    clips['idle'] = build_clip(rig, 'idle', [(0, P()), (15, idle_a), (30, idle_b), (45, idle_c), (60, P())], 60)

    def steer(sign):
        """sign +1 = left. Lean into the turn, look where you go, wheel hands up on the outside / down on the inside."""
        up, down = (18, 0, 0), (-18, 0, 0)
        return P(chest=R(0, -9 * sign, 5 * sign), spine=R(0, -4 * sign, 0), neck=R(0, 0, 8 * sign), head=R(0, -4 * sign, 18 * sign),
                 upperArm_R=((up if sign > 0 else down), (0, 0, 0)), upperArm_L=((down if sign > 0 else up), (0, 0, 0)),
                 forearm_R=R(-6, 0, 0), forearm_L=R(-6, 0, 0))
    clips['steerL'] = build_clip(rig, 'steerL', [(0, P()), (15, steer(+1))], 15)
    clips['steerR'] = build_clip(rig, 'steerR', [(0, P()), (15, steer(-1))], 15)

    # trick: arms thrown up, head spins, torso hops
    up = P(chest=R(-6, 0, 0, (0, 0, 0.04)), spine=R(0, 0, 0, (0, 0, 0.03)), neck=R(0, 0, 25), head=R(-8, 0, 40),
           upperArm_L=R(120, -34, 0), upperArm_R=R(120, 34, 0), forearm_L=R(-14, 0, 0), forearm_R=R(-14, 0, 0))
    up2 = P(chest=R(-4, 0, 0, (0, 0, 0.05)), spine=R(0, 0, 0, (0, 0, 0.04)), neck=R(0, 0, -20), head=R(-6, 0, -40),
            upperArm_L=R(140, -40, 0), upperArm_R=R(140, 40, 0), forearm_L=R(-20, 0, 0), forearm_R=R(-20, 0, 0))
    clips['trick'] = build_clip(rig, 'trick', [(0, P()), (5, up), (11, up2), (18, P())], 18)

    # hit: snap back, wobble, recover
    h1 = P(chest=R(14, 0, 0, (0, 0, 0)), spine=R(0, 0, 0, (0, -0.035, 0)), neck=R(18, 0, 0), head=R(30, 6, 10), upperArm_L=R(24, 0, -10), upperArm_R=R(24, 0, 10))
    h2 = P(chest=R(8, -6, -4), spine=R(0, 0, 0, (0, -0.02, 0)), neck=R(10, 0, 6), head=R(18, -10, -14), upperArm_L=R(16, 0, -6), upperArm_R=R(16, 0, 6))
    h3 = P(chest=R(4, 5, 3), neck=R(5, 0, -4), head=R(8, 6, 8), upperArm_L=R(8), upperArm_R=R(8))
    clips['hit'] = build_clip(rig, 'hit', [(0, P()), (4, h1), (9, h2), (14, h3), (19, P(head=R(2, 0, -2))), (24, P())], 24)

    # lookBack: torso and head turned ~100 deg to the left, holds the last pose
    lb = P(chest=R(0, 0, 38), spine=R(0, 0, 6), neck=R(0, 0, 22), head=R(-2, 0, 36), upperArm_L=R(-2, 0, -10), upperArm_R=R(6, 0, -14),
           forearm_L=R(0, 0, -12), forearm_R=R(0, 0, -10))
    clips['lookBack'] = build_clip(rig, 'lookBack', [(0, P()), (12, lb)], 12)

    # victory: both arms up, torso bounces twice per loop, head sways
    def vic(h, sway, lean, wave):
        return P(spine=R(0, 0, 0, (0, 0, h)), chest=R(0, lean, 0), neck=R(0, 0, sway), head=R(-4, lean * 0.5, sway * 1.5),
                 upperArm_L=R(150 + wave, -24, 0), upperArm_R=R(150 - wave, 24, 0), forearm_L=R(-10, 0, 0), forearm_R=R(-10, 0, 0))
    clips['victory'] = build_clip(rig, 'victory', [
        (0, vic(0.0, 0, 0, 0)), (8, vic(0.06, 6, 3, 8)), (15, vic(0.0, 9, 4, 0)), (23, vic(0.06, 3, 0, -8)),
        (30, vic(0.0, 0, -3, 0)), (38, vic(0.06, -6, -3, 8)), (45, vic(0.0, -9, -4, 0)), (53, vic(0.06, -3, 0, -8)),
        (60, vic(0.0, 0, 0, 0)),
    ], 60)
    return clips
