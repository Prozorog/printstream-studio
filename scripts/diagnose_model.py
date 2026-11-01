import bpy,json,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
rows=[]
for ob in bpy.data.objects['Rifle'].children_recursive:
 if ob.type!='MESH':continue
 bpy.context.view_layer.update()
 bounds=[ob.matrix_world@Vector(v) for v in ob.bound_box]
 bm=bmesh.new();bm.from_mesh(ob.data)
 rows.append({'name':ob.name,'location':list(ob.location),'world':list(ob.matrix_world.translation),'bounds':[[min(v[i] for v in bounds) for i in range(3)],[max(v[i] for v in bounds) for i in range(3)]],'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonmanifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(f.calc_area()<1e-10 for f in bm.faces),'uvs':[u.name for u in ob.data.uv_layers]})
 bm.free()
bounds={row['name']:row['bounds'] for row in rows}
rounds=[name for name in bounds if name.startswith('Cartridge')]
loaded={'exposedCartridges':[name for name in rounds if bounds[name][1][2]>bounds['MagBody'][1][2]+.0001],
        'followerBelowStack':bounds['MagFollower'][1][2]<min(bounds[name][0][2] for name in rounds),
        'springBelowFollower':bounds['MagSpring'][1][2]<bounds['MagFollower'][0][2]}
assert loaded['exposedCartridges']==['Cartridge'] and loaded['followerBelowStack'] and loaded['springBelowFollower'], loaded
images=[im for im in bpy.data.images if im.source=='FILE']
result={'parts':rows,'actions':[a.name for a in bpy.data.actions],'textures':[{'name':im.name,'packed':bool(im.packed_file),'size':list(im.size)} for im in images],'loadedMagazine':loaded}
(ROOT/'artifacts/geometry-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'meshes':len(rows),'issues':[r for r in rows if r['boundaryEdges'] or r['nonmanifoldEdges'] or r['zeroAreaFaces'] or r['uvs']!=['UV0','AO_UV']],'actions':len(result['actions']),'textures':len(images),'packed':sum(bool(im.packed_file) for im in images),'loadedMagazine':loaded},indent=2))
