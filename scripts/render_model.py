"""Denoised 2560-wide serial Cycles shots; never starts concurrent render jobs.
Use -- --preview for 1440 previews or -- --shot receiver to render one changed view.
"""
import bpy, math, json, sys, time
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
scene=bpy.context.scene; camera=scene.camera
scene.render.engine='CYCLES'; scene.cycles.samples=64 if '--preview' in args else 96; scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED'; scene.render.threads=4
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type='OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use=d.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception: scene.cycles.device='CPU'
scene.render.resolution_x=1440 if '--preview' in args else 2560
scene.render.resolution_y=810 if '--preview' in args else 1440
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGB'
scene.frame_set(1)
rest=json.loads((ROOT/'artifacts/geometry-stats.json').read_text(encoding='utf-8'))
# Render-only transform ownership: retained master actions must not overwrite shot poses.
for ob in bpy.data.objects['Rifle'].children_recursive: ob.animation_data_clear()
# Framing is explicit and repeatable; all angles retain true cross-section depth.
shots={
 'left-profile':{'pos':(0,-20,-.265),'target':(0,0,-.265),'scale':10.45},
 'hero':{'pos':(-3,-14,5.4),'target':(0,0,-.34),'scale':10.95},
 'suppressor-handguard':{'pos':(-8,-6,2.8),'target':(-2.45,0,.01),'scale':5.0},
 'receiver':{'pos':(-.8,-8,2.3),'target':(1.12,0,-.24),'scale':4.15},
 'exploded':{'pos':(-1,-23,8),'target':(.7,0,-.75),'scale':19.7},
}
if '--shot' in args: shots={args[args.index('--shot')+1]:shots[args[args.index('--shot')+1]]}
folder=ROOT/('artifacts/previews' if '--preview' in args else 'public/renders'); folder.mkdir(parents=True,exist_ok=True)
report=[]
for label,shot in shots.items():
    for name,state in rest['rest'].items():
        ob=bpy.data.objects[name]; ob.location=state['location']; ob.rotation_euler=state['rotation']
    floor=bpy.data.objects.get('Studio cyclorama'); floor.hide_render=label in ['left-profile','exploded']
    if label=='exploded':
        for name,delta in rest['explode'].items(): bpy.data.objects[name].location+=Vector(delta)
    camera.data.type='ORTHO'; camera.data.ortho_scale=shot['scale']
    camera.location=shot['pos']; camera.rotation_euler=(Vector(shot['target'])-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    scene.render.filepath=str(folder/(label+'.png'))
    started=time.perf_counter(); bpy.ops.render.render(write_still=True)
    report.append({'shot':label,'file':scene.render.filepath,'width':scene.render.resolution_x,'samples':scene.cycles.samples,'seconds':round(time.perf_counter()-started,2),'camera':shot})
    print('SHOT_COMPLETE',json.dumps(report[-1]),flush=True)
for name,state in rest['rest'].items():
    ob=bpy.data.objects[name]; ob.location=state['location']; ob.rotation_euler=state['rotation']
(ROOT/'artifacts'/('preview-renders.json' if '--preview' in args else 'cycles-renders.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
