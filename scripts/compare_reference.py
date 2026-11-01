"""Deterministic source/render sampling in common rifle coordinates.
Pixel ranges are measured in clean face regions, with dark ink excluded from pearl statistics.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import numpy as np, json, sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets/reference.png'
ref=Image.open(SOURCE).convert('RGB'); render=Image.open(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'public/renders/left-profile.png').convert('RGB')
# Source annotations use the supplied 1568x882 preview, scaled exactly to the 4K original.
def reference_pixel(x,z): return ((31+(x+5)*150.1)*ref.width/1568,(397-z*150.1)*ref.height/882)
def render_pixel(x,z):
    px=render.width/10.45
    return (render.width/2+x*px,render.height/2-(z+.265)*px)
spots=[
 ('Suppressor',-4.17,.075,.23,.115,True),
 ('Handguard',-.82,.135,.24,.115,True),
 ('Receiver',1.31,-.31,.18,.095,True),
 ('Magazine',.35,-1.27,.19,.16,True),
 ('Grip',2.18,-1.37,.12,.11,False),
 ('Stock',4.27,-.14,.18,.10,False),
]
def sample(im,mapper,spec):
    name,x,z,hx,hz,pearl=spec
    a=mapper(x-hx,z+hz); b=mapper(x+hx,z-hz)
    box=tuple(round(v) for v in (a[0],a[1],b[0],b[1]))
    data=np.asarray(im.crop(box)).reshape(-1,3).astype(float)
    lum=data@np.array([.2126,.7152,.0722])
    # Exclude black printed ink and near-white background only from pearl gradient statistics.
    clean=data[(lum>85)&(lum<251)] if pearl else data[(lum<130)]
    if len(clean)==0: clean=data
    l=clean@np.array([.2126,.7152,.0722])
    rgb=np.mean(clean,axis=0)
    return {
        'box':box, 'meanRGB':[round(float(v),1) for v in rgb],
        'luminanceMean':round(float(l.mean()),1),
        'luminanceP05':round(float(np.percentile(l,5)),1),
        'luminanceP95':round(float(np.percentile(l,95)),1),
        'luminanceRange':round(float(l.max()-l.min()),1),
        'robustRange':round(float(np.percentile(l,95)-np.percentile(l,5)),1),
        'neutralDelta':round(float(max(abs(rgb[0]-rgb[1]),abs(rgb[1]-rgb[2]))),1),
        'retainedPixels':len(clean), 'totalPixels':len(data),
        'unmaskedPeakRGB':[int(v) for v in data.max(axis=0)],
        'clippedPixelPercent':round(float(np.any(data>=255,axis=1).mean()*100),3),
    }
rows=[{'part':s[0],'worldCenter':[s[1],s[2]],'reference':sample(ref,reference_pixel,s),'render':sample(render,render_pixel,s)} for s in spots]
(ROOT/'artifacts/sampled-spots.json').write_text(json.dumps({'method':'Fixed world-coordinate rectangular crops; pearl ink excluded at Y<=85; background Y>=251; black stats select Y<130. Range is max-min within crop. RGB/luminance use encoded sRGB byte values, Rec.709 coefficients.','spots':rows},indent=2),encoding='utf-8')
# Side-by-side, identical silhouette scale and baseline, with sampling marks.
canvas=Image.new('RGB',(2560,1050),'#f3f3f1'); d=ImageDraw.Draw(canvas)
try:
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',24); small=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',16)
except OSError: font=ImageFont.load_default(); small=font
for index,(im,mapper,title) in enumerate([(ref,reference_pixel,'SUPPLIED REFERENCE'),(render,render_pixel,'CYCLES / LEFT PROFILE')]):
    bounds=(mapper(-5.2,1.08)[0],mapper(-5.2,1.08)[1],mapper(5.2,-2.0)[0],mapper(5.2,-2.0)[1])
    cut=im.crop(tuple(round(v) for v in bounds)); cut=cut.resize((1230,365),Image.Resampling.LANCZOS)
    x0=25+1280*index; y0=145
    canvas.paste(cut,(x0,y0)); d.text((x0,55),title,fill='#151615',font=font)
    d.text((x0,95),'M4A1-S / PRINTSTREAM   —   SAME SCALE + BORE DATUM',fill='#646862',font=small)
    for n,s in enumerate(spots):
        x=x0+(s[1]+5.2)/10.4*1230; y=y0+(1.08-s[2])/3.08*365
        d.line([(x-7,y),(x+7,y)],fill='#767b72',width=1); d.line([(x,y-7),(x,y+7)],fill='#767b72',width=1)
        d.text((x+8,y-14),str(n+1),fill='#51574d',font=small)
    d.line((x0,550,x0+1230,550),fill='#c8cbc5')
    d.text((x0,580),'PART             MEAN RGB              Y RANGE      5–95%       NEUTRAL Δ',fill='#151615',font=small)
    for n,row in enumerate(rows):
        v=row['reference' if index==0 else 'render']
        text=f"{n+1} {row['part']:<14} {str(v['meanRGB']):<23} {v['luminanceRange']:>6.1f}        {v['robustRange']:>5.1f}        {v['neutralDelta']:>4.1f}"
        d.text((x0,620+n*42),text,fill='#30332e',font=small)
d.text((25,940),'Ink excluded from pearl ranges. Black neutrality is measured in encoded RGB. Exact crop coordinates and statistics: artifacts/sampled-spots.json.',fill='#646862',font=small)
d.text((25,980),'Original supplied image / procedural visual study. Not a dimensioned or functional manufacturing asset.',fill='#646862',font=small)
canvas.save(ROOT/'public/renders/reference-comparison.png')
print(json.dumps(rows,indent=2))
