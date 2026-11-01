"""Reproducible visual-game asset. Units are composition units, not manufacturing dimensions.
X: muzzle(-5) -> butt(+5), Z up, camera-left -Y. glTF converts to Y-up.
Every major shell owns a volumetric section; openings are actual geometry.
Run Blender background --python scripts/build_model.py -- [--preview|--bake].
"""
import bpy, bmesh, math, json, os, sys
from pathlib import Path
from mathutils import Vector
from math import sin, cos, pi
ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / 'assets/textures'
OUT = ROOT / 'artifacts'
OUT.mkdir(exist_ok=True)
(ROOT/'public/models').mkdir(parents=True, exist_ok=True)
(ROOT/'public/downloads').mkdir(parents=True, exist_ok=True)
(ROOT/'public/renders').mkdir(parents=True, exist_ok=True)
ARGS = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
SEED = 214
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'NONE'
scene['asset_note'] = 'Unofficial visual study. Illustrative, nonfunctional internals; not manufacturing CAD.'
scene['authoring_frame'] = 'X muzzle-to-butt; Z up; -Y left side; total length 10 visual units'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.seed = SEED
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for dev in prefs.devices: dev.use = dev.type == 'OPTIX'
    scene.cycles.device = 'GPU'
except Exception:
    scene.cycles.device = 'CPU'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -0.25
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = False
scene.render.resolution_percentage = 100
parts = {}
MATS = {}
specs = json.loads((ROOT/'assets/materials.json').read_text(encoding='utf-8'))['materials']

def srgb(s):
    vals = [int(s[i:i+2],16)/255 for i in (1,3,5)]
    return [(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for v in vals] + [1]

def image(path, color=True):
    p = ROOT/path
    im = bpy.data.images.load(str(p), check_existing=True)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im

def material(name):
    if name in MATS: return MATS[name]
    s=specs[name]
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; links=m.node_tree.links
    bs=n.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=srgb(s['baseColorSrgb'])
    bs.inputs['Metallic'].default_value=s['metalness']
    bs.inputs['Roughness'].default_value=s['roughness']
    bs.inputs['Coat Weight'].default_value=s.get('clearcoat',{}).get('factor',0)
    bs.inputs['Coat Roughness'].default_value=s.get('clearcoat',{}).get('roughness',.08)
    uv=n.new('ShaderNodeUVMap'); uv.uv_map='UV0'
    for key,inp,col in [('baseColorTexture','Base Color',True),('roughnessTexture','Roughness',False)]:
        if s.get(key):
            tx=n.new('ShaderNodeTexImage'); tx.image=image(s[key],col); tx.label=key
            links.new(uv.outputs['UV'],tx.inputs['Vector']); links.new(tx.outputs['Color'],bs.inputs[inp])
    if s.get('normalTexture'):
        tx=n.new('ShaderNodeTexImage'); tx.image=image(s['normalTexture'],False)
        # Authored local UV0 supports consistent close-up detail without procedural shader dependence.
        links.new(uv.outputs['UV'],tx.inputs['Vector'])
        normal=n.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=s.get('normalScale',1)
        links.new(tx.outputs['Color'],normal.inputs['Color']); links.new(normal.outputs['Normal'],bs.inputs['Normal'])
    ir=s.get('iridescence',{})
    if ir.get('factor',0)>0 and 'Thin Film Thickness' in bs.inputs:
        bs.inputs['Thin Film IOR'].default_value=ir.get('ior',1.3)
        if ir.get('thicknessTexture'):
            tx=n.new('ShaderNodeTexImage'); tx.image=image(ir['thicknessTexture'],False)
            links.new(uv.outputs['UV'],tx.inputs['Vector'])
            mapn=n.new('ShaderNodeMapRange'); mapn.inputs['From Min'].default_value=0; mapn.inputs['From Max'].default_value=1
            mapn.inputs['To Min'].default_value=ir.get('thicknessMinimum',250); mapn.inputs['To Max'].default_value=ir.get('thicknessMaximum',450)
            links.new(tx.outputs['Color'],mapn.inputs['Value']); links.new(mapn.outputs[0],bs.inputs['Thin Film Thickness'])
        else: bs.inputs['Thin Film Thickness'].default_value=340
    m.diffuse_color=srgb(s['baseColorSrgb']); MATS[name]=m
    return m

def active(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob

def mesh(name,verts,faces,mat='PearlTrim',smooth=False):
    me=bpy.data.meshes.new(name+'_Mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); scene.collection.objects.link(ob)
    me.materials.append(material(mat))
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,dist=1e-9,edges=list(bm.edges))
    bmesh.ops.delete(bm,geom=[e for e in bm.edges if not e.link_faces],context='EDGES')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth=smooth
    if smooth: me.set_sharp_from_angle(angle=math.radians(38))
    return ob

def bevel(ob,width=.008,segments=2):
    active(ob)
    mod=ob.modifiers.new('Machined edge radius','BEVEL'); mod.width=width; mod.segments=segments; mod.limit_method='ANGLE'; mod.angle_limit=.35; mod.harden_normals=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    try:
        mod=ob.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); mod.keep_sharp=True; mod.weight=40
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception: pass
    return ob

def cube(name,loc,scale,mat='SatinSteel',edge=.008):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); ob=bpy.context.object; ob.name=name
    ob.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(material(mat))
    return bevel(ob,edge,2) if edge else ob

def join(name,objects,pivot=None):
    obs=[o for o in objects if o is not None]
    active(obs[0])
    for o in obs: o.select_set(True)
    if len(obs)>1: bpy.ops.object.join()
    ob=bpy.context.object; ob.name=name
    if pivot is not None:
        scene.cursor.location=pivot; bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); scene.cursor.location=(0,0,0)
    parts[name]=ob
    bpy.context.view_layer.update()
    return ob

def cut(ob,cutter):
    active(ob); mod=ob.modifiers.new('True machined aperture','BOOLEAN'); mod.operation='DIFFERENCE'; mod.solver='EXACT'; mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name); bpy.data.objects.remove(cutter,do_unlink=True)
    return ob

def cross(hy,hz,c):
    c=min(c,hy*.8,hz*.8)
    return [(-hy+c,-hz),(hy-c,-hz),(hy,-hz+c),(hy,hz-c),(hy-c,hz),(-hy+c,hz),(-hy,hz-c),(-hy,-hz+c)]

def loft_x(name,sections,mat='PearlTrim',edge=.008):
    # Each section: x, centreY, bottomZ, topZ, halfDepth, designed chamfer.
    vv=[]
    for x,cy,bot,top,hy,c in sections:
        mid=(bot+top)/2; hz=(top-bot)/2
        vv.extend((x,cy+y,mid+z) for y,z in cross(hy,hz,c))
    ff=[tuple(range(7,-1,-1))]
    for j in range(len(sections)-1):
        for k in range(8): ff.append((j*8+k,j*8+(k+1)%8,(j+1)*8+(k+1)%8,(j+1)*8+k))
    ff.append(tuple((len(sections)-1)*8+k for k in range(8)))
    ob=mesh(name,vv,ff,mat)
    return bevel(ob,edge) if edge else ob

def lathe(name,profile,mat='SatinSteel',cy=0,cz=0,segs=64,angles=(0,2*pi),closed=True,edge=0):
    # Profile is a closed radial cross-section, not a side-outline extrusion.
    a0,a1=angles; full=abs(a1-a0-2*pi)<1e-5; n=segs if full else segs+1
    vv=[(x,cy+r*cos(a0+(a1-a0)*j/segs),cz+r*sin(a0+(a1-a0)*j/segs)) for x,r in profile for j in range(n)]
    ff=[]
    for i in range(len(profile) if closed else len(profile)-1):
        ni=(i+1)%len(profile)
        for j in range(segs):
            nj=(j+1)%n
            ff.append((i*n+j,i*n+nj,ni*n+nj,ni*n+j))
    if not full:
        ff.append(tuple(i*n for i in range(len(profile)-1,-1,-1)))
        ff.append(tuple(i*n+segs for i in range(len(profile))))
    ob=mesh(name,vv,ff,mat,True)
    return bevel(ob,edge) if edge else ob

def cylinder(name,loc,r,depth,mat='SatinSteel',axis='X',segs=32,edge=.004):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs,radius=r,depth=depth,location=loc)
    ob=bpy.context.object; ob.name=name
    if axis=='X': ob.rotation_euler[1]=pi/2
    elif axis=='Y': ob.rotation_euler[0]=pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    ob.data.materials.append(material(mat))
    for p in ob.data.polygons: p.use_smooth=len(p.vertices)==4
    return bevel(ob,edge) if edge else ob

def rod(name,a,b,r,mat='SatinSteel',segs=16):
    av,bv=Vector(a),Vector(b); ob=cylinder(name,(av+bv)/2,r,(bv-av).length,mat,'Z',segs,0)
    ob.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler(); active(ob); bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    return ob

def sweep(name,points,r,mat='SatinSteel',segs=8):
    vv=[]; pts=[Vector(p) for p in points]
    for i,p in enumerate(pts):
        d=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        ref=Vector((0,1,0)) if abs(d.y)<.95 else Vector((0,0,1))
        u=d.cross(ref).normalized(); v=d.cross(u).normalized()
        vv.extend(tuple(p+r*(cos(k*2*pi/segs)*u+sin(k*2*pi/segs)*v)) for k in range(segs))
    ff=[tuple(range(segs-1,-1,-1))]
    for i in range(len(pts)-1):
        for j in range(segs): ff.append((i*segs+j,i*segs+(j+1)%segs,(i+1)*segs+(j+1)%segs,(i+1)*segs+j))
    ff.append(tuple((len(pts)-1)*segs+j for j in range(segs)))
    return mesh(name,vv,ff,mat,True)

def rounded_outline(points,radius,segments=4):
    result=[]
    for i,point in enumerate(points):
        corner=Vector(point)
        before=Vector(points[i-1])-corner
        after=Vector(points[(i+1)%len(points)])-corner
        distance=min(radius,before.length*.4,after.length*.4)
        start=corner+before.normalized()*distance
        end=corner+after.normalized()*distance
        for j in range(segments+1):
            t=j/segments
            result.append(tuple((1-t)**2*start+2*(1-t)*t*corner+t*t*end))
    return result

def frame(name,outer,inner,depth,mat='PearlTrim',edge=.012):
    # Continuous aperture shell. Width tapers with height; front/back are bevelled, not a slab.
    vv=[]; n=len(outer)
    for sign,loop in [(-1,outer),(-1,inner),(1,outer),(1,inner)]:
        for x,z in loop: vv.append((x,sign*depth*(1-.12*max(0,z)),z))
    ff=[]
    for j in range(n):
        k=(j+1)%n
        ff.extend([(j,k,n+k,n+j),(2*n+k,2*n+j,3*n+j,3*n+k),(k,j,2*n+j,2*n+k),(n+j,n+k,3*n+k,3*n+j)])
    return bevel(mesh(name,vv,ff,mat),edge,3)

def ref_outline(points):
    # Measured in the supplied 1568x882 view; these are composition coordinates.
    return [((x-31)/150.1-5,(397-z)/150.1) for x,z in points]

def profile_body(name,outline,depth,mat='PearlTrim',edge=.012):
    n=len(outline)
    vv=[(x,sign*depth,z) for sign in [-1,1] for x,z in outline]
    ff=[tuple(range(n-1,-1,-1)),tuple(n+i for i in range(n))]
    ff.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    ob=mesh(name,vv,ff,mat)
    return bevel(ob,edge,4) if edge else ob

def fuse(ob,addition):
    active(ob)
    mod=ob.modifiers.new('Continuous forged volume','BOOLEAN')
    mod.operation='UNION'; mod.solver='EXACT'; mod.object=addition
    mod.material_mode='TRANSFER'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(addition,do_unlink=True)
    return ob

def finish_shell(ob):
    # Remove Boolean slivers below 0.005 reference pixels, not modeled detail.
    bm=bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=3e-5)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=3e-5)
    bmesh.ops.dissolve_limit(bm,angle_limit=1e-4,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False,delimit={'MATERIAL','UV'})
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    active(ob)
    normals=ob.modifiers.new('Shell surface normals','WEIGHTED_NORMAL'); normals.keep_sharp=True; normals.weight=40
    bpy.ops.object.modifier_apply(modifier=normals.name)
    return ob

def projected_uv(ob,mode='box',bounds=None):
    bpy.context.view_layer.update()
    me=ob.data; uv=me.uv_layers.get('UV0') or me.uv_layers.new(name='UV0')
    coords=[ob.matrix_world@v.co for v in me.vertices]
    mn=Vector([min(v[i] for v in coords) for i in range(3)]); mx=Vector([max(v[i] for v in coords) for i in range(3)])
    if bounds: mn,mx=Vector(bounds[0]),Vector(bounds[1])
    sz=mx-mn
    for p in me.polygons:
        normal=ob.matrix_world.to_3x3()@p.normal
        face_mode=mode
        source_material=me.materials[p.material_index].name
        blank=None
        if mode in ('receiver','two') and abs(normal.y)<.65:
            blank={'PearlReceiver':'PearlTrim','GripPolymer':'BlackPolymer','StockPolymer':'BlackPolymer'}.get(source_material)
        elif mode=='cyl' and abs(normal.x)>.8:
            blank='PearlTrim'
        if blank:
            blank_material=material(blank)
            index=next((i for i,m in enumerate(me.materials) if m==blank_material),None)
            if index is None: me.materials.append(blank_material); index=len(me.materials)-1
            p.material_index=index; face_mode='box'
        for li in p.loop_indices:
            v=coords[me.loops[li].vertex_index]
            if face_mode=='cyl':
                u=(v.x-mn.x)/max(sz.x,.001); vv=math.atan2(v.z,v.y)/(2*pi)%1
            elif face_mode=='receiver':
                u=(v.x-.05)/2.4; vv=.02+.46*(v.z+.93)/1.8
                if normal.y>0: vv+=.5
            elif face_mode=='two':
                u=(v.x-mn.x)/max(sz.x,.001); vv=.02+.46*(v.z-mn.z)/max(sz.z,.001)
                if normal.y>0: vv+=.5
            else:
                ax=max(range(3),key=lambda a:abs(normal[a])); axes=[a for a in range(3) if a!=ax]
                u=(v[axes[0]]-mn[axes[0]])/max(sz[axes[0]],.001); vv=(v[axes[1]]-mn[axes[1]])/max(sz[axes[1]],.001)
            uv.data[li].uv=(u,vv)
    # Correct wrap seams face-by-face, preserving cylindrical texel density.
    if mode=='cyl':
        for p in me.polygons:
            vals=[uv.data[i].uv.y for i in p.loop_indices]
            if max(vals)-min(vals)>.5:
                for li in p.loop_indices:
                    if uv.data[li].uv.y<.5: uv.data[li].uv.y+=1

def receiver_uv(ob,upper=False):
    projected_uv(ob,'receiver')
    # Re-fit the existing artwork to the measured housing, without recoloring it.
    for p in ob.data.polygons:
        if ob.data.materials[p.material_index].name!='PearlReceiver': continue
        normal=ob.matrix_world.to_3x3()@p.normal
        for li in p.loop_indices:
            v=ob.matrix_world@ob.data.vertices[ob.data.loops[li].vertex_index].co
            x=.28+(v.x-.28)*1.12 if upper else v.x-.10
            z=v.z+.075 if upper else v.z-.06
            ob.data.uv_layers['UV0'].data[li].uv=((x-.05)/2.4,.02+.46*(z+.93)/1.8+(.5 if normal.y>0 else 0))

# MUZZLE / TURNED FORWARD ASSEMBLY
sup=lathe('Suppressor',[(-5,.034),(-5,.18),(-4.992,.194),(-4.978,.209),(-4.955,.216),(-4.93,.218),(-3.29,.218),(-3.265,.216),(-3.245,.208),(-3.235,.19),(-3.235,.065),(-3.27,.055),(-4.91,.034)],'PearlSuppressor',segs=160)
join('Suppressor',[sup],(-3.22,0,0)); projected_uv(sup,'cyl',((-5,-.22,-.22),(-3.1,.22,.22)))
col=lathe('Mount sleeve',[(-3.32,.062),(-3.32,.215),(-3.314,.224),(-3.30,.23),(-3.23,.23),(-3.215,.223),(-3.20,.20),(-3.19,.10),(-3.19,.062)],'PearlTrim',segs=128)
lug=profile_body('Mount indexing lug',rounded_outline(ref_outline([(300,417),(307,419),(309,425),(323,425),(324,431),(300,431)]),.009),.075,'SatinSteel',.004)
join('Suppressor_Collar',[col,lug],(-3.2,0,0))
bar=lathe('Barrel',[(-3.25,.035),(-3.25,.085),(-3.10,.096),(-2.72,.096),(-2.70,.064),(-2.47,.064),(-2.45,.083),(-1.62,.083),(-1.58,.115),(.2,.115),(.2,.035)],segs=96)
join('Barrel',[bar],(-1.7,0,0))
join('GasBlock',[lathe('Gas block',[(-2.05,.084),(-2.05,.12),(-1.69,.12),(-1.69,.084)],segs=48)],(-1.86,0,0))
front=profile_body('A frame sight',rounded_outline(ref_outline([(475,414),(477,310),(480,303),(487,300),(495,302),(502,308),(538,358),(542,369),(541,414),(533,415),(533,397),(483,397),(482,416)]),.014),.073,'SatinSteel',.009)
triangle=profile_body('Sight triangular opening',rounded_outline(ref_outline([(486,328),(500,328),(527,362),(524,368),(486,368)]),.016),.3,'SatinSteel',0)
cut(front,triangle)
slot=profile_body('Sight lower slot',rounded_outline(ref_outline([(486,375),(526,375),(527,380),(485,380)]),.009),.3,'SatinSteel',0)
cut(front,slot); bevel(front,.004,3)
post=cylinder('Sight post',(-1.935,0,.405),.013,.11,'SatinSteel','Z',32,.002)
post_base=cube('Sight post seat',(-1.96,0,.37),(.065,.09,.10),'SatinSteel',.007)
join('FrontSight',[front,post,post_base],(-1.92,0,0))
lug=profile_body('Bayonet block',rounded_outline(ref_outline([(460,415),(475,415),(475,421),(488,421),(488,429),(482,432),(462,429)]),.008),.075,'SatinSteel',.005)
loop=sweep('Sling swivel',[(-1.66,-.10,-.14),(-1.66,-.12,-.20),(-1.66,-.07,-.245),(-1.66,.07,-.245),(-1.66,.12,-.20),(-1.66,.10,-.14)],.012)
join('BayonetLug',[lug,loop],(-2,0,-.14))
# Flat panel fields, narrow rounded dividers and a raised longitudinal seam.
profile=[(-1.60,.215),(-1.597,.252),(-1.58,.278),(-1.565,.293),(-1.548,.293),(-1.531,.284)]
for px in [565,584,603,623,642,661,680,699,719,738,757,776]:
    x=ref_outline([(px,397)])[0][0]; taper=1-.018*abs((x+.77)/.83)
    profile.extend([(x-.018,.287*taper),(x-.010,.296*taper),(x-.005,.301*taper),(x+.005,.301*taper),(x+.012,.295*taper),(x+.018,.287*taper)])
profile.extend([(.034,.274),(.047,.256),(.055,.238),(.055,.205),(-1.60,.195)])
for name,ang in [('Handguard_Top',(0,pi)),('Handguard_Bottom',(pi,2*pi))]:
    ob=lathe(name,profile,'PearlHandguard',cz=.008,segs=72,angles=ang)
    additions=[]
    if name=='Handguard_Top':
        for side in [-1,1]:
            additions.append(loft_x('Handguard longitudinal seam',[(-1.58,side*.279,-.018,.028,.01,.005),(-1.51,side*.29,-.018,.028,.012,.005),(-.03,side*.29,-.018,.028,.012,.005),(.035,side*.267,-.018,.028,.01,.005)],'PearlTrim',.004))
    join(name,[ob]+additions,(-.77,0,0))
    projected_uv(ob,'cyl',((-1.60,-.31,-.31),(.055,.31,.31)))
join('HandguardCap',[lathe('Front handguard retaining cap',[(-1.65,.091),(-1.65,.251),(-1.62,.272),(-1.59,.272),(-1.59,.091)],'SatinSteel',segs=64)],(-1.62,0,0))
join('DeltaRing',[lathe('Tapered delta ring',[(.047,.12),(.047,.266),(.075,.29),(.11,.29),(.16,.235),(.16,.12)],'PearlTrim',segs=64)],(.1,0,0))
# The upper is a round, flattened forging, not a rectangular box.
upper_sections=[(.10,.177),(.19,.194),(.34,.192),(1.99,.183),(2.16,.177),(2.31,.16),(2.35,.143)]
upper_segments=96
upper_verts=[(x,max(-.178,min(.178,r*cos(j*2*pi/upper_segments))),max(-.145,min(.157,-.009+r*sin(j*2*pi/upper_segments)))) for x,r in upper_sections for j in range(upper_segments)]
upper_faces=[tuple(range(upper_segments-1,-1,-1))]
for i in range(len(upper_sections)-1):
    for j in range(upper_segments):
        k=(j+1)%upper_segments
        upper_faces.append((i*upper_segments+j,i*upper_segments+k,(i+1)*upper_segments+k,(i+1)*upper_segments+j))
upper_faces.append(tuple((len(upper_sections)-1)*upper_segments+j for j in range(upper_segments)))
upper=mesh('UpperReceiver',upper_verts,upper_faces,'PearlReceiver',True)
cut(upper,cube('Ejection port cutter',(1.15,.19,.035),(.93,.29,.17),'SatinSteel',.04))
cut(upper,cylinder('Carrier channel clearance',(1.23,0,.025),.112,2.4,'SatinSteel','X',64,0))
shoulder=profile_body('Upper split-line shoulder',ref_outline([(801,411),(1099,411),(1120,401),(1126,405),(1122,418),(800,418)]),.184,'PearlReceiver',0)
fuse(upper,shoulder); bevel(upper,.006,3)
finish_shell(upper)
rear_collar=lathe('Receiver rear collar',[(2.28,.112),(2.28,.157),(2.32,.175),(2.38,.175),(2.405,.16),(2.405,.112)],'PearlTrim',segs=96)
join('UpperReceiver',[upper,rear_collar],(1.18,0,.015))

# Trace the handle's base, arch and recessed rear ramp separately.
carry=profile_body('CarryHandle',rounded_outline(ref_outline([(797,377),(797,337),(799,326),(805,317),(816,311),(1030,284),(1041,283),(1051,287),(1058,296),(1082,346),(1090,354),(1107,357),(1107,377)]),.02),.125,'PearlReceiver',.009)
window=profile_body('Rounded handle opening',rounded_outline(ref_outline([(809,356),(808,339),(811,329),(818,322),(827,320),(1006,320),(1016,323),(1023,331),(1032,350),(1030,356),(1021,357),(820,357)]),.025),.4,'PearlReceiver',0)
cut(carry,window)
ramp=profile_body('Recessed rear sight ramp',rounded_outline(ref_outline([(1036,329),(1071,329),(1082,349),(1078,355),(1037,355),(1036,350)]),.014),.065,'PearlReceiver',0)
ramp.location.y=-.125; cut(carry,ramp)
cut(carry,cube('Sight channel',(1.12,0,.725),(1.30,.105,.13),'SatinSteel',.009))
cut(carry,cube('Charging rail clearance',(1.35,0,.163),(1.90,.09,.065),'PearlReceiver',0))
bevel(carry,.006,3)
join('CarryHandle',[carry],(1.1,0,.18))
rear=cube('Rear sight base',(2.12,0,.204),(.19,.21,.065),'SatinSteel',.012)
aperture=cylinder('Rear aperture',(2.12,0,.258),.044,.035,'SatinSteel','X',40,.004)
cut(aperture,cylinder('Rear sight aperture hole',(2.12,0,.258),.018,.12,'SatinSteel','X',32,0))
knob=cylinder('Rear sight windage',(2.15,-.14,.218),.047,.06,'SatinSteel','Y',48,.004)
screw=cylinder('Carry screw',(1.69,-.127,.615),.025,.012,'PearlTrim','Y',40,.002)
screw_slot=cube('Carry screw slot',(1.69,-.135,.615),(.027,.012,.004),'SatinSteel',.001)
join('RearSight',[rear,aperture,knob,screw,screw_slot],(2.12,0,.22))

# The lower follows the flared well, rounded trigger throat and rear grip arc.
low=profile_body('LowerReceiver',rounded_outline(ref_outline([(800,418),(1098,418),(1136,413),(1134,454),(1120,455),(1107,459),(1096,466),(1087,479),(1019,479),(1019,527),(930,527),(813,508),(812,503),(815,442),(810,437),(805,430)]),.016),.181,'PearlReceiver',.022)
opening=profile_body('Trigger throat cutter',rounded_outline(ref_outline([(931,538),(928,514),(928,499),(931,488),(937,481),(944,479),(993,479),(1004,483),(1011,493),(1013,504),(1009,517),(1003,538)]),.018),.5,'PearlTrim',0)
cut(low,opening)
cut(low,cube('Magazine well bore',(.525,0,-.62),(.52,.343,.62),'SatinSteel',.025))
for x,z in [(.23,-.21),(2.16,-.19)]:
    cut(low,cylinder('Takedown bore',(x,0,z),.035,.8,'SatinSteel','Y',32,0))
well_panel=profile_body('Magwell raised side',rounded_outline(ref_outline([(818,421),(881,421),(881,514),(813,502),(816,444)]),.025),.19,'PearlReceiver',.009)
fuse(low,well_panel)
catch_pillar=profile_body('Magazine catch pillar',rounded_outline(ref_outline([(883,419),(907,419),(915,424),(915,476),(925,480),(925,522),(881,514)]),.025),.20,'PearlReceiver',.012)
fuse(low,catch_pillar)
rear_arc=profile_body('Forged rear grip transition',rounded_outline(ref_outline([(1062,453),(1078,438),(1098,431),(1135,431),(1134,454),(1120,455),(1106,460),(1096,468),(1088,480),(1077,480)]),.027),.193,'PearlReceiver',.014)
fuse(low,rear_arc)
bevel(low,.005,3)
maglip=profile_body('Flared magwell lip',rounded_outline(ref_outline([(811,500),(926,520),(930,525),(925,529),(811,509),(808,505)]),.012),.214,'PearlTrim',.006)
cut(maglip,cube('Lip magazine cavity',(.525,0,-.80),(.54,.343,.5),'SatinSteel',.02))
fence=sweep('Forged control fence',[(x,-.204,z) for x,z in ref_outline([(926,521),(926,480),(930,471),(944,468),(949,460),(949,421)])],.014,'PearlTrim',12)
selector_pad=cylinder('Selector boss',(1.66,-.19,-.32),.055,.016,'PearlTrim','Y',48,.003)
pins=[]
for px,py,r in [(983,431,.012),(1006,447,.013),(1030,445,.016),(1077,424,.012),(1105,438,.012)]:
    x,z=ref_outline([(px,py)])[0]
    pins.append(cylinder('Forged pin seat',(x,-.185,z),r,.014,'PearlTrim','Y',32,.002))
for px,py in [(1009,440),(1009,452)]:
    x,z=ref_outline([(px,py)])[0]
    pins.append(cube('Raised receiver stamp',(x,-.195,z),(.095,.018,.026),'PearlTrim',.01))
holo=cube('Holographic lower foil',(.39,-.196,-.552),(.25,.002,.055),'Holographic',.0005)
join('LowerReceiver',[low,maglip,fence,selector_pad,holo]+pins,(1.2,0,-.36))

# Individually moving controls keep the original semantic part names.
for name,x,z in [('TakedownPin_Front',.23,-.21),('TakedownPin_Rear',2.16,-.19)]:
    pin=cylinder(name,(x,0,z),.032,.392,'SatinSteel','Y',40,.003)
    cap=cylinder('Pin face',(x,-.20,z),.031,.008,'PearlTrim','Y',40,.002)
    join(name,[pin,cap],(x,0,z))
selector=[cylinder('Selector axle',(1.66,-.205,-.32),.031,.04,'SatinSteel','Y',48,.003)]
paddle=profile_body('Selector paddle',rounded_outline(ref_outline([(1035,440),(1065,440),(1069,443),(1066,448),(1035,446)]),.012),.015,'SatinSteel',.004)
paddle.location.y=-.227
join('SelectorLever',selector+[paddle],(1.66,-.205,-.32))
catch_outline=rounded_outline(ref_outline([(934,400),(940,404),(940,412),(937,420),(939,427),(938,435),(933,443),(929,448),(927,443),(929,434),(929,427),(925,424),(925,417),(928,414),(928,404)]),.01)
catch=profile_body('Sculpted bolt catch',catch_outline,.023,'PearlTrim',.005)
catch.location.y=-.218
backing=profile_body('Bolt catch backing',[(1.02+(x-1.02)*1.12,-.225+(z+.225)*1.025) for x,z in catch_outline],.027,'SatinSteel',.004)
backing.location.y=-.207
catch_pin=cylinder('Catch pivot',(1.02,-.22,-.225),.025,.068,'SatinSteel','Y',40,.003)
join('BoltCatch',[catch,catch_pin,backing],(1.02,-.214,-.225))
left_button=profile_body('Magazine catch face',rounded_outline(ref_outline([(884,449),(890,446),(900,446),(905,450),(904,455),(884,455)]),.012),.015,'PearlTrim',.004)
left_button.location.y=-.213
release=cube('Right release button',(1.47,.183,-.29),(.107,.038,.063),'SatinSteel',.016)
join('MagRelease',[left_button,release],(1.47,.185,-.29))
trig=profile_body('Curved trigger blade',rounded_outline(ref_outline([(975,480),(984,481),(990,490),(993,501),(990,511),(984,520),(978,523),(976,522),(982,513),(984,504),(981,494),(973,484)]),.009),.026,'SatinSteel',.004)
join('Trigger',[trig],(1.30,0,-.55))
guard=profile_body('TriggerGuard',rounded_outline(ref_outline([(929,516),(937,522),(1004,522),(1014,515),(1016,520),(1013,526),(1007,528),(936,528),(928,523)]),.012),.115,'PearlTrim',.007)
join('TriggerGuard',[guard],(.95,0,-.8))
hammer=loft_x('Hammer',[(1.14,0,-.38,-.12,.055,.015),(1.18,0,-.40,.04,.065,.015),(1.27,0,-.38,.06,.06,.015)],'SatinSteel',.009)
join('Hammer',[hammer],(1.2,0,-.37))
# RIGHT SIDE functional viewing features, distinct from left print layout.
dust=cube('DustCover',(1.15,.217,.025),(.93,.032,.18),'SatinSteel',.014)
rib=cube('Dust cover stamp',(1.15,.238,.025),(.74,.014,.105),'SatinSteel',.01)
hinge=cylinder('Dust cover hinge',(1.15,.217,-.08),.022,.98,'SatinSteel','X',24,.003)
join('DustCover',[dust,rib,hinge],(1.15,.217,-.08))
fa=rod('ForwardAssist stem',(1.95,.14,.065),(2.11,.32,.065),.062,'SatinSteel',24)
facap=cylinder('Assist button',(2.11,.32,.065),.072,.065,'SatinSteel','Y',24,.003)
deflect=loft_x('Brass deflector',[(1.72,.18,-.08,.11,.025,.015),(1.83,.235,-.06,.14,.065,.025),(1.91,.18,-.06,.13,.035,.02)],'PearlReceiver',.009)
join('ForwardAssist',[fa,facap,deflect],(2.0,.2,.06)); projected_uv(parts['ForwardAssist'],'receiver')
charge=loft_x('Charging rail',[(.50,0,.145,.175,.036,.008),(2.22,0,.145,.175,.036,.008),(2.28,0,.132,.19,.115,.014)],'SatinSteel',.004)
handle=cube('Charging T grip',(2.25,0,.164),(.14,.43,.076),'SatinSteel',.019)
join('ChargingHandle',[charge,handle],(2.23,0,.16))
bcg=lathe('Carrier shell',[(.53,.034),(.53,.087),(.70,.105),(1.75,.105),(1.85,.084),(2.1,.084),(2.1,.034)],'SatinSteel',cz=.025,segs=40)
key=cube('Carrier key',(1.28,0,.133),(.55,.07,.05),'SatinSteel',.008)
join('BoltCarrier',[bcg,key],(1.21,0,.025))
blt=lathe('Bolt',[(.44,0),(.44,.066),(.53,.075),(.58,.066),(.80,.045),(.80,0)],'SatinSteel',cz=.025,segs=32)
join('Bolt',[blt],(.57,0,.025))
# CURVED MAGAZINE: nested rounded rectangular lofts, real recessed longitudinal channels.
magverts=[]; rows=20; across=64
# Rounded rectangle perimeter with side groove depth, CCW.
def mag_section(cx,z,hx,hy,inner=False):
    result=[]
    for side in [-1,1]:
        iterable=range(across+1) if side==-1 else range(across,-1,-1)
        for j in iterable:
            t=j/across; xx=-hx+2*hx*t
            edge=.024*(max(0,1-min(t,1-t)/.08))
            grooves=sum(.016*math.exp(-((t-v)/.05)**4) for v in [.30,.65]) if not inner else 0
            yy=side*(hy-edge-grooves)
            t_height=max(0,min(1,(z+1.69)/1.13))
            result.append((cx+xx,yy,z-.28*xx*(1-t_height)**.5))
    return result
N=(across+1)*2
for inside in [False,True]:
    for j in range(rows+1):
        t=j/rows; z=-1.69+1.13*t; cx=.355+.20*(1-(1-t)**2)
        hx=.345-(.018 if inside else 0); hy=.16-(.045 if inside else 0)
        magverts.extend(mag_section(cx,z,hx,hy,inside))
magfaces=[]
for inside in [0,1]:
    base=inside*(rows+1)*N
    for j in range(rows):
        for k in range(N):
            f=(base+j*N+k,base+j*N+(k+1)%N,base+(j+1)*N+(k+1)%N,base+(j+1)*N+k)
            magfaces.append(f if not inside else f[::-1])
for j in [0,rows]:
    for k in range(N): magfaces.append((j*N+k,j*N+(k+1)%N,(rows+1)*N+j*N+(k+1)%N,(rows+1)*N+j*N+k))
mag=mesh('MagBody',magverts,magfaces,'PearlMagazine',True)
join('MagBody',[mag],(.55,0,-.55))
uv=mag.data.uv_layers.new(name='UV0')
for p in mag.data.polygons:
    for li in p.loop_indices:
        v=mag.matrix_world@mag.data.vertices[mag.data.loops[li].vertex_index].co
        t=(v.z+1.69)/1.13; cx=.355+.20*(1-(1-t)**2)
        uv.data[li].uv=((v.x-cx+.345)/.69,.02+.46*t+(.5 if p.normal.y>0 else 0))
base=loft_x('Magazine base',[(.005,0,-1.621,-1.600,.17,.01),(.71,0,-1.819,-1.798,.17,.01)],'PearlTrim',.004)
base_seam=loft_x('Magazine base seam',[(.008,0,-1.623,-1.617,.17,.003),(.708,0,-1.821,-1.815,.17,.003)],'SatinSteel',.001)
join('MagBaseplate',[base,base_seam],(.355,0,-1.70))
follower=cube('MagFollower',(.55,0,-.98),(.57,.21,.05),'BlackPolymer',.024)
join('MagFollower',[follower],(.55,0,-.98))
sp=[]
for j in range(193):
    t=j/192; a=t*2*pi*8
    sp.append((.37+.22*cos(a)+.18*t,.083*sin(a),-1.62+.59*t))
join('MagSpring',[sweep('Magazine spring',sp,.012,'SatinSteel',7)],(.43,0,-1.325))
for i in range(5):
    # Illustrative nonfunctional cartridge silhouette, no assembly/machining dimensions.
    xx=.55; yy=(-1 if i%2==0 else 1)*.064; zz=-.53-i*.09
    case=lathe('Brass case',[(xx-.22,0),(xx-.22,.042),(xx-.205,.045),(xx+.12,.037),(xx+.15,.026),(xx+.15,0)],'Brass',cy=yy,cz=zz,segs=24)
    bullet=lathe('Copper projectile',[(xx+.15,0),(xx+.15,.026),(xx+.24,.022),(xx+.30,.006),(xx+.305,0)],'Copper',cy=yy,cz=zz,segs=24)
    nm='Cartridge' if i==0 else f'Cartridge_{i+1:02}'
    cartridge=join(nm,[case,bullet],(xx,yy,zz))
    cartridge.rotation_euler.z=pi; active(cartridge)
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
maggroup=bpy.data.objects.new('Magazine',None); scene.collection.objects.link(maggroup)
maggroup.location=(.55,0,-.56); maggroup.empty_display_type='CUBE'; maggroup.empty_display_size=.15
bpy.context.view_layer.update()
for nm in ['MagBody','MagFollower','MagSpring','MagBaseplate','Cartridge','Cartridge_02','Cartridge_03','Cartridge_04','Cartridge_05']:
    ob=parts[nm]; matrix=ob.matrix_world.copy(); ob.parent=maggroup
    ob.matrix_parent_inverse=maggroup.matrix_world.inverted()
    ob.matrix_basis=matrix
parts['Magazine']=maggroup
# Reference front/back contours produce a curved grip with a slanted heel.
grv=[]; grs=[(1019,480,1082,480,.143),(1019,512,1101,512,.15),(1027,525,1110,525,.155),(1038,547,1124,547,.155),(1033,553,1129,553,.158),(1047,559,1133,559,.154),(1058,589,1152,589,.149),(1078,637,1170,628,.15),(1075,647,1173,633,.158),(1079,654,1174,634,.16)]
for fx,fz,bx,bz,hy in grs:
    (xf,zf),(xb,zb)=ref_outline([(fx,fz),(bx,bz)])
    hx=(xb-xf)/2; cx=(xb+xf)/2
    for xx,yy in rounded_outline(cross(hx,hy,.045),.025):
        grv.append((cx+xx,yy,zf+(zb-zf)*(xx+hx)/(2*hx)))
grn=len(grv)//len(grs)
grf=[tuple(range(grn-1,-1,-1))]
for j in range(len(grs)-1):
    for k in range(grn): grf.append((j*grn+k,j*grn+(k+1)%grn,(j+1)*grn+(k+1)%grn,(j+1)*grn+k))
grf.append(tuple((len(grs)-1)*grn+k for k in range(grn)))
grip=bevel(mesh('PistolGrip',grv,grf,'GripPolymer',True),.01,3)
for side in [-1,1]:
    panel=profile_body('Recessed grip stipple panel',rounded_outline(ref_outline([(1044,498),(1070,496),(1143,620),(1097,628),(1075,578),(1054,550)]),.025),.018,'GripPolymer',0)
    panel.location.y=side*.163; cut(grip,panel)
    for offset in [.024,.047,.070]:
        cut(grip,rod('Backstrap molded flute',(2.04-offset,side*.146,-.69),(2.59-offset,side*.146,-1.56),.005,'GripPolymer',12))
bevel(grip,.003,3)
join('PistolGrip',[grip],(1.78,0,-.55)); projected_uv(grip,'two')
# Rounded telescoping sleeve, solid lower web and a narrow real sling slot.
buf=lathe('BufferTube',[(2.34,.09),(2.34,.143),(2.40,.148),(2.45,.139),(4.65,.139),(4.65,.09)],'SatinSteel',segs=80)
rail=loft_x('Stock detent rail',[(2.66,0,-.22,-.08,.068,.012),(4.58,0,-.22,-.08,.068,.012)],'SatinSteel',.006)
for x in [3.05,3.35,3.65,3.95]: cut(rail,cylinder('Stock detent hole',(x,0,-.20),.027,.16,'SatinSteel','Z',20,0))
join('BufferTube',[buf,rail],(2.44,0,0))
springpoints=[(2.46+t*1.85,.075*cos(t*2*pi*20),.075*sin(t*2*pi*20)) for t in [i/480 for i in range(481)]]
join('BufferSpring',[sweep('Buffer return spring',springpoints,.009,'SatinSteel',7)],(3.4,0,0))
join('Buffer',[lathe('Buffer weight',[(2.5,0),(2.5,.078),(2.61,.078),(2.65,.062),(3.02,.062),(3.02,0)],'Brass',segs=32)],(2.7,0,0))
stock=lathe('Stock shell',[(3.14,.152),(3.14,.203),(3.155,.217),(3.18,.222),(4.79,.224),(4.85,.218),(4.88,.201),(4.88,.152)],'StockPolymer',cz=-.023,segs=112)
web=profile_body('Stock solid lower web',rounded_outline(ref_outline([(1303,430),(1517,430),(1519,524),(1508,521),(1377,466),(1304,466)]),.022),.085,'BlackPolymer',.014)
fuse(stock,web)
slot=profile_body('Lower stock sling slot',rounded_outline(ref_outline([(1444,438),(1499,438),(1503,441),(1502,446),(1444,446),(1441,443)]),.012),.4,'BlackPolymer',0)
cut(stock,slot); bevel(stock,.004,3)
finish_shell(stock)
sling=profile_body('Stock upper sling loop',rounded_outline(ref_outline([(1440,370),(1440,358),(1445,352),(1516,350),(1522,356),(1524,370)]),.016),.08,'BlackPolymer',.008)
upper_slot=profile_body('Upper stock sling opening',rounded_outline(ref_outline([(1448,367),(1448,360),(1452,357),(1511,356),(1515,360),(1515,366)]),.012),.3,'BlackPolymer',0)
cut(sling,upper_slot); bevel(sling,.003,3)
join('Stock',[stock,sling],(3.25,0,0)); projected_uv(stock,'two')
lever=profile_body('Stock adjustment paddle',rounded_outline(ref_outline([(1310,451),(1327,444),(1373,444),(1432,482),(1434,514),(1429,516),(1351,471),(1310,471)]),.02),.162,'BlackPolymer',.012)
button=cylinder('Stock adjustment button',(3.82,0,-.49),.043,.16,'SatinSteel','Z',40,.005)
join('StockLever',[lever,button],(3.73,0,-.34))
butt=profile_body('Contoured butt pad',rounded_outline(ref_outline([(1512,354),(1520,349),(1528,352),(1532,365),(1534,453),(1533,510),(1530,534),(1525,540),(1518,537),(1513,523),(1511,382)]),.02),.218,'Rubber',.018)
traction=[]
for i in range(12):
    z=-.72+i*.072
    traction.append(sweep('Butt traction',[(5.008,-.16,z),(5.019,0,z+.018),(5.008,.16,z)],.006,'Rubber',8))
join('ButtPad',[butt]+traction,(4.86,0,-.3))
# Final receiver UV fitting preserves the existing paint after geometry merging.
receiver_uv(parts['UpperReceiver'],True)
receiver_uv(parts['CarryHandle'],True)
receiver_uv(parts['LowerReceiver'])
# Reapply foil-specific texture coordinates after receiver hardware merge.
ob=parts['LowerReceiver']
for p in ob.data.polygons:
    if ob.data.materials[p.material_index].name=='Holographic':
        for li in p.loop_indices:
            v=ob.matrix_world@ob.data.vertices[ob.data.loops[li].vertex_index].co
            ob.data.uv_layers['UV0'].data[li].uv=((v.x-.265)/.25,(v.z+.58)/.055)
# Group preserves local pivots and the independently animated magazine subassembly.
root=bpy.data.objects.new('Rifle',None); scene.collection.objects.link(root)
for name,ob in parts.items():
    if ob.parent is None:
        mw=ob.matrix_world.copy(); ob.parent=root; ob.matrix_world=mw
    ob['part_id']=name
    if ob.type=='MESH' and not ob.data.uv_layers.get('UV0'): projected_uv(ob)
# AO UV1: one atlas tile per physical part, independent per-part bake prevents exploded stains.
meshes=[o for o in parts.values() if o.type=='MESH']
cols=7; rows=math.ceil(len(meshes)/cols)
for idx,ob in enumerate(meshes):
    active(ob)
    # Primitive operators create UVMap; canonical export order is strictly UV0, AO_UV.
    for layer in list(ob.data.uv_layers):
        if layer.name!='UV0': ob.data.uv_layers.remove(layer)
    bm=bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm,dist=1e-6,edges=list(bm.edges))
    bmesh.ops.delete(bm,geom=[e for e in bm.edges if not e.link_faces],context='EDGES')
    bm.to_mesh(ob.data); bm.free()
    uv=ob.data.uv_layers.new(name='AO_UV')
    ob.data.uv_layers.active=uv
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.1519,island_margin=.025,area_weight=.25,correct_aspect=True,scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Edit-mode UV operators replace CustomData; the earlier RNA layer handle is stale.
    uv=ob.data.uv_layers['AO_UV']
    for loop in uv.data:
        loop.uv.x=(idx%cols+.045+.91*loop.uv.x)/cols
        loop.uv.y=(idx//cols+.045+.91*loop.uv.y)/rows
    ob.data.update()
    assert all(idx%cols/cols <= p.uv.x <= (idx%cols+1)/cols and idx//cols/rows <= p.uv.y <= (idx//cols+1)/rows for p in ob.data.uv_layers['AO_UV'].data), f'AO tile packing failed: {ob.name}'
    ob.data.uv_layers.active_index=0
    ob.data.uv_layers['UV0'].active_render=True
# Saved editable actions: field-strip, unscrew, charge, mag release, stock extension.
scene.render.fps=30; scene.frame_start=1; scene.frame_end=96
REST={name:{'location':list(ob.location),'rotation':list(ob.rotation_euler)} for name,ob in parts.items()}
EXPLODE={
'Suppressor':(-2.1,0,0),'Suppressor_Collar':(-1.5,0,0),'Barrel':(-1.05,0,.68),'FrontSight':(-1.05,0,.68),'BayonetLug':(-1.05,0,.68),'GasBlock':(-1.05,0,.68),'Handguard_Top':(-1.05,0,1.48),'Handguard_Bottom':(-1.05,0,.04),'DeltaRing':(-.63,0,.68),'HandguardCap':(-1.05,0,.68),
'UpperReceiver':(0,0,1.7),'CarryHandle':(0,0,1.7),'RearSight':(0,0,1.7),'DustCover':(0,.65,1.5),'ForwardAssist':(.35,.6,1.7),'ChargingHandle':(2.25,0,2.25),'BoltCarrier':(2.35,0,1.45),'Bolt':(1.6,0,.95),
'Trigger':(.55,0,-.75),'TriggerGuard':(.7,0,-1.2),'Hammer':(1.25,0,-.8),'SelectorLever':(1.9,-.65,-.6),'BoltCatch':(-.2,-.7,-.5),'MagRelease':(.3,.65,-.6),'TakedownPin_Front':(-.15,-.8,.2),'TakedownPin_Rear':(.3,-.8,.2),
'Magazine':(-.75,0,-1.1),'MagFollower':(0,0,.75),'MagSpring':(0,0,-1.0),'MagBaseplate':(0,0,-1.3),'Cartridge':(0,0,.8),'Cartridge_02':(0,0,1.09),'Cartridge_03':(0,0,1.38),'Cartridge_04':(0,0,1.67),'Cartridge_05':(0,0,1.96),
'PistolGrip':(1.05,0,-1.4),'BufferTube':(2.6,0,.4),'BufferSpring':(3,0,1.0),'Buffer':(2.9,0,-.45),'Stock':(4.5,0,0),'StockLever':(4.5,0,-.7),'ButtPad':(4.7,0,0)}
def action_keys(ob,label,channel,end,frames=(1,66,96)):
    initial=list(getattr(ob,channel))
    ob.animation_data_clear()
    for fr,val in [(frames[0],initial),(frames[1],end),(frames[2],initial)]:
        setattr(ob,channel,val); ob.keyframe_insert(data_path=channel,frame=fr)
    action=ob.animation_data.action; action.name=label+'__'+ob.name
    track=ob.animation_data.nla_tracks.new(); track.name=label
    strip=track.strips.new(label,1,action); strip.mute=False
    ob.animation_data.action=None; setattr(ob,channel,initial)
for name,delta in EXPLODE.items():
    ob=parts[name]; start=ob.location.copy()
    action_keys(ob,'FieldStrip','location',list(start+Vector(delta)))
# Supplemental actions retained as assets; field strip remains one NLA track per part.
def supplemental(ob,label,channels):
    initial={path:list(getattr(ob,path)) for path in channels}
    for path,end in channels.items():
        for fr,value in [(1,initial[path]),(25,end),(55,end),(80,initial[path])]:
            setattr(ob,path,value); ob.keyframe_insert(data_path=path,frame=fr)
    act=ob.animation_data.action; act.name=label; act.use_fake_user=True
    tr=ob.animation_data.nla_tracks.new(); tr.name=label; st=tr.strips.new(label,1,act); st.mute=True
    ob.animation_data.action=None
    for path,value in initial.items(): setattr(ob,path,value)
supplemental(parts['Suppressor'],'Suppressor_Unscrew',{'location':list(parts['Suppressor'].location+Vector((-1.25,0,0))),'rotation_euler':[pi*4,0,0]})
supplemental(parts['ChargingHandle'],'ChargingHandle_Pull',{'location':list(parts['ChargingHandle'].location+Vector((.48,0,0)))})
supplemental(parts['DustCover'],'DustCover_Open',{'rotation_euler':[-pi*.63,0,0]})
supplemental(parts['Magazine'],'Magazine_Release',{'location':list(parts['Magazine'].location+Vector((0,0,-1.1)))})
supplemental(parts['Stock'],'Stock_Extension',{'location':list(parts['Stock'].location+Vector((.65,0,0)))})
scene.frame_set(1)
# Neutral contrasty studio: luminous white panels separated by a nearly black world.
world=bpy.data.worlds.new('Neutral dark reflection studio'); scene.world=world; world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.055,.055,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.65
# A camera-only white backdrop does not wash dark reflection gaps out of the coat.
wn=world.node_tree.nodes; wl=world.node_tree.links
camera_bg=wn.new('ShaderNodeBackground'); camera_bg.inputs[0].default_value=(1,1,1,1); camera_bg.inputs[1].default_value=6
ray=wn.new('ShaderNodeLightPath'); mix=wn.new('ShaderNodeMixShader')
wl.new(ray.outputs['Is Camera Ray'],mix.inputs[0]); wl.new(wn['Background'].outputs[0],mix.inputs[1]); wl.new(camera_bg.outputs[0],mix.inputs[2]); wl.new(mix.outputs[0],wn['World Output'].inputs[0])

def area(name,loc,power,size,size_y,target):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='RECTANGLE'; data.size=size; data.size_y=size_y
    ob=bpy.data.objects.new(name,data); scene.collection.objects.link(ob); ob.location=loc; ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    return ob
area('Key / neutral upper-left',(-4,-3.2,4.8),1100,3.8,1.2,(0,0,0))
area('Long rim',(1,2.2,4),900,6,.8,(0,0,0))
area('Front fill',(1,-5,2.3),450,5,3,(.6,0,-.3))
area('Muzzle edge',(-6,1,2),300,2,2,(-3,0,0))
floor=cube('Studio cyclorama',(0,0,-2.03),(200,200,.1),'PearlTrim',0)
fmat=bpy.data.materials.new('Gallery white'); fmat.use_nodes=True; fmat.node_tree.nodes.remove(fmat.node_tree.nodes['Principled BSDF'])
# Camera-only cyclorama uses true short-range AO for its soft grounding shadow.
# It does not turn the reflection environment into a flat white dome.
fn=fmat.node_tree.nodes; fl=fmat.node_tree.links
floor_ao=fn.new('ShaderNodeAmbientOcclusion'); floor_ao.inputs['Distance'].default_value=3; floor_ao.samples=4
floor_emission=fn.new('ShaderNodeEmission'); floor_emission.inputs['Strength'].default_value=3
floor_mix=fn.new('ShaderNodeMixShader'); floor_ray=fn.new('ShaderNodeLightPath')
floor_transparent=fn.new('ShaderNodeBsdfTransparent')
fl.new(floor_ao.outputs['Color'],floor_emission.inputs['Color'])
fl.new(floor_ray.outputs['Is Camera Ray'],floor_mix.inputs[0]); fl.new(floor_transparent.outputs[0],floor_mix.inputs[1]); fl.new(floor_emission.outputs[0],floor_mix.inputs[2]); fl.new(floor_mix.outputs[0],fn['Material Output'].inputs[0])
floor.data.materials.clear(); floor.data.materials.append(fmat)
camdata=bpy.data.cameras.new('Studio camera'); cam=bpy.data.objects.new('Studio camera',camdata); scene.collection.objects.link(cam); scene.camera=cam
camdata.type='ORTHO'; camdata.ortho_scale=10.65

def camera(pos,target,scale):
    cam.location=pos; cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler(); camdata.ortho_scale=scale
camera((0,-20,3.5),(0,0,-.35),10.9)
scene.render.resolution_x=1440; scene.render.resolution_y=810
# Restore all transforms before serialization, and capture explicit measurements.
for name,vals in REST.items():
    parts[name].location=vals['location']; parts[name].rotation_euler=vals['rotation']
bpy.context.view_layer.update()
stats=[]
for ob in meshes:
    ob.data.calc_loop_triangles()
    stats.append({'name':ob.name,'triangles':len(ob.data.loop_triangles),'vertices':len(ob.data.vertices),'materials':[m.name for m in ob.data.materials if m], 'pivot':list(ob.matrix_world.translation), 'uvSets':[u.name for u in ob.data.uv_layers]})
(OUT/'geometry-stats.json').write_text(json.dumps({'seed':SEED,'parts':stats,'triangles':sum(x['triangles'] for x in stats),'blender':bpy.app.version_string,'frame':'Blender X length Z up -Y left','rest':REST,'explode':EXPLODE},indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'m4a1s-printstream.blend'))
print('MODEL_BUILT',json.dumps({'parts':len(parts),'triangles':sum(x['triangles'] for x in stats)}),flush=True)
if '--preview' in ARGS or '--profile' in ARGS:
    scene.cycles.samples=64
    for label,pos,target,scale in [('profile-blockout',(0,-20,-.265),(0,0,-.265),10.45),('hero-blockout',(-3,-14,5.4),(0,0,-.35),10.8)]:
        if '--profile' in ARGS and label!='profile-blockout': continue
        bpy.data.objects['Studio cyclorama'].hide_render=label=='profile-blockout'
        camera(pos,target,scale); scene.render.filepath=str(OUT/(label+'.png')); bpy.ops.render.render(write_still=True)
if '--bake' in ARGS:
    exec(compile((ROOT/'scripts/bake_export.py').read_text(encoding='utf-8'),str(ROOT/'scripts/bake_export.py'),'exec'))
