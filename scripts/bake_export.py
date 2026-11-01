"""Bake isolated part AO, preserve pivots/UV1, export only the Rifle hierarchy.
Run with the authored blend loaded: blender -b artifacts/m4a1s-printstream.blend --python scripts/bake_export.py.
"""
import bpy, json, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
scene=bpy.context.scene
root=bpy.data.objects['Rifle']
meshes=[o for o in root.children_recursive if o.type=='MESH']
scene.render.engine='CYCLES'; scene.cycles.samples=64; scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED'; scene.render.threads=4
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type='OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use=d.type=='OPTIX'
    scene.cycles.device='GPU'
except Exception: scene.cycles.device='CPU'
path=ROOT/'assets/textures/ao.png'
im=bpy.data.images.get('Isolated part AO') or bpy.data.images.new('Isolated part AO',width=2048,height=2048,alpha=False)
im.generated_color=(1,1,1,1); im.colorspace_settings.name='Non-Color'; im.filepath_raw=str(path); im.file_format='PNG'
# Every material has the same active image target, but each part occupies disjoint UV1 tiles.
for mat in {m for ob in meshes for m in ob.data.materials if m}:
    nodes=mat.node_tree.nodes
    target=nodes.get('Isolated part AO target') or nodes.new('ShaderNodeTexImage')
    target.name='Isolated part AO target'; target.image=im
    for n in nodes: n.select=False
    target.select=True; nodes.active=target
visibility={o.name:o.hide_render for o in scene.objects}
for ob in scene.objects:
    if ob.type=='MESH': ob.hide_render=True
start=time.perf_counter(); baked=[]
for index,ob in enumerate(meshes):
    bpy.ops.object.select_all(action='DESELECT'); ob.hide_render=False; ob.select_set(True); bpy.context.view_layer.objects.active=ob
    ob.data.uv_layers.active=ob.data.uv_layers['AO_UV']
    bpy.ops.object.bake(type='AO',use_clear=False,margin=3,uv_layer='AO_UV')
    ob.data.uv_layers.active=ob.data.uv_layers['UV0']; ob.data.uv_layers['UV0'].active_render=True
    ob.hide_render=True; baked.append(ob.name)
    print('AO_PART',index+1,len(meshes),ob.name,flush=True)
im.save()
for ob in scene.objects: ob.hide_render=visibility.get(ob.name,False)
# Keep the AO image visible in the shader editor and exported through its canonical glTF node socket.
ng=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
if not any(s.name=='Occlusion' for s in ng.interface.items_tree): ng.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
for mat in {m for ob in meshes for m in ob.data.materials if m}:
    node=mat.node_tree.nodes.new('ShaderNodeGroup'); node.node_tree=ng
    tex=mat.node_tree.nodes['Isolated part AO target']
    uv=mat.node_tree.nodes.new('ShaderNodeUVMap'); uv.uv_map='AO_UV'
    mat.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
    mat.node_tree.links.new(tex.outputs['Color'],node.inputs['Occlusion'])
# Preserve editable polygon construction while giving the glTF tangent builder triangles.
for ob in meshes:
    triangulate=ob.modifiers.new('Export triangulation','TRIANGULATE')
    triangulate.quad_method='FIXED'; triangulate.ngon_method='BEAUTY'
    if hasattr(triangulate,'keep_custom_normals'): triangulate.keep_custom_normals=True
# Save the packed editable master, including camera, lights, animations and textures.
scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'artifacts/m4a1s-printstream.blend'))
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
for ob in root.children_recursive: ob.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(ROOT/'artifacts/m4a1s-raw.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_extras=True,export_cameras=False,export_lights=False,export_image_format='AUTO',export_draco_mesh_compression_enable=False,export_current_frame=False)
report={'type':'Cycles AO','samples':64,'resolution':[2048,2048],'uv':'AO_UV / TEXCOORD_1','isolation':'Every part baked alone; no inter-part shadows','parts':baked,'seconds':round(time.perf_counter()-start,2),'image':str(path)}
(ROOT/'artifacts/ao-bake.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BAKE_EXPORT_COMPLETE',json.dumps(report),flush=True)
