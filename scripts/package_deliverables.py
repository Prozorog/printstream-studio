"""Publish locally generated downloads. No network or deployment actions."""
from pathlib import Path
import shutil, zipfile
ROOT=Path(__file__).resolve().parents[1]
downloads=ROOT/'public/downloads'; downloads.mkdir(parents=True,exist_ok=True)
master=ROOT/'artifacts/m4a1s-printstream.blend'
shutil.copy2(master,downloads/master.name)
shots=['left-profile.png','hero.png','suppressor-handguard.png','receiver.png','exploded.png','reference-comparison.png']
with zipfile.ZipFile(downloads/'renders.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
 for name in shots: archive.write(ROOT/'public/renders'/name,name)
licenses=ROOT/'public/licenses'; licenses.mkdir(parents=True,exist_ok=True)
for package,name in [('@fontsource-variable/space-grotesk','Space-Grotesk-OFL.txt'),('@fontsource/ibm-plex-mono','IBM-Plex-Mono-OFL.txt')]:
 shutil.copy2(ROOT/'node_modules'/package/'LICENSE',licenses/name)
print({'blend':str(downloads/master.name),'renders':str(downloads/'renders.zip'),'views':len(shots)})
