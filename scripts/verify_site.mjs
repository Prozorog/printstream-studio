import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const URL=process.argv[2]||'http://127.0.0.1:4102';
const inputsOnly=process.argv.includes('--inspect-inputs-only');
const OUT=path.join(ROOT,'artifacts/screenshots'); await mkdir(OUT,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=d3d11','--force-high-performance-gpu','--disable-background-timer-throttling']});
const report={url:URL,created:new Date().toISOString(),screens:[],poses:{},errors:[],measurements:[],checks:[]};
const assert=(value,message)=>{ if(!value)throw new Error(message); report.checks.push(message); };
const frames=async(page,count=4)=>page.evaluate(n=>new Promise(resolve=>{let i=0;function step(){if(++i>=n)resolve();else requestAnimationFrame(step)}requestAnimationFrame(step)}),count);
async function api(page,method,...args){return page.evaluate(({method,args})=>window.__PRINTSTREAM__[method](...args),{method,args});}
async function state(page){return page.evaluate(()=>window.__PRINTSTREAM__.getState());}
async function snap(page,prefix,name){await frames(page); const file=path.join(OUT,`${prefix}-${name}.png`);await page.screenshot({path:file});report.screens.push(path.relative(ROOT,file));report.poses[`${prefix}-${name}`]=await state(page);}
async function cameraSettled(page){
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  let previous=[],stable=0;const start=performance.now();
  function tick(){
   const state=window.__PRINTSTREAM__.getState();const current=[...state.cameraPosition,...state.cameraTarget];
   stable=current.every((v,i)=>Math.abs(v-previous[i])<.0001)?stable+1:0;previous=current;
   if(stable>=15)resolve();else if(performance.now()-start>10000)reject(new Error('Camera did not settle'));else requestAnimationFrame(tick);
  }requestAnimationFrame(tick);
 }));
}
async function measure(page,label){
 const timing=await page.evaluate(()=>new Promise(resolve=>{const dt=[];let previous=performance.now(),maxDrawCalls=0,maxTriangles=0;function tick(now){dt.push(now-previous);previous=now;const stats=window.__PRINTSTREAM__.stats;maxDrawCalls=Math.max(maxDrawCalls,stats.drawCalls);maxTriangles=Math.max(maxTriangles,stats.triangles);if(dt.length<180)requestAnimationFrame(tick);else{const sorted=dt.slice().sort((a,b)=>a-b);resolve({fps:1000/(dt.reduce((a,b)=>a+b,0)/dt.length),p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxDrawCalls,maxTriangles})}}requestAnimationFrame(tick)}));
 const info=await page.evaluate(()=>{const api=window.__PRINTSTREAM__;const canvas=document.querySelector('canvas');const gl=canvas.getContext('webgl2');const dbg=gl?.getExtension('WEBGL_debug_renderer_info');return {state:api.getState(),renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'unavailable',canvas:[canvas.width,canvas.height],modelTiming:performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.glb')).map(e=>({duration:e.duration,transferSize:e.transferSize,decodedBodySize:e.decodedBodySize}))}});
 report.measurements.push({label,...timing,...info});
}
async function verifyInspectInputs(page){
 await api(page,'preset','hero',{immediate:true});await cameraSettled(page);
 const panel=page.getByRole('dialog');
 const cameras=panel.getByRole('navigation',{name:'Camera presets'});
 await cameras.getByRole('button',{name:'right',exact:true}).click();await cameraSettled(page);
 const right=await state(page);
 assert(right.cameraPosition[2]<right.cameraTarget[2]-1,'Inspect: actual Right preset button exposes the opposite side');
 await cameras.getByRole('button',{name:'hero',exact:true}).click();await cameraSettled(page);
 const positions=()=>page.evaluate(()=>{const e=window.__PRINTSTREAM__;e.model.updateWorldMatrix(true,true);return['Stock','StockLever','ButtPad'].map(name=>{const n=e.model.getObjectByName(name);return n.getWorldPosition(n.position.clone()).toArray();});});
 const rest=await positions();let previous=rest;
 for(const detent of [1,2,3,0]){
  await panel.getByRole('group',{name:'Stock detents'}).getByRole('button',{name:`0${detent+1}`,exact:true}).click();
  await page.waitForFunction(progress=>Math.abs(window.__PRINTSTREAM__.getState().mechanical.stock-progress)<.001,detent/3);
  await page.waitForFunction(({before,rest,reset})=>{const e=window.__PRINTSTREAM__;e.model.updateWorldMatrix(true,true);return['Stock','StockLever','ButtPad'].every((name,i)=>{const n=e.model.getObjectByName(name),p=n.getWorldPosition(n.position.clone()).toArray();return reset?p.every((v,j)=>Math.abs(v-rest[i][j])<.001):p[0]>before[i][0]+.05;});},{before:previous,rest,reset:detent===0});
  previous=await positions();
  assert(true,`Inspect: detent ${detent+1} moves the stock, lever and pad together`);
 }
 const explode=panel.getByRole('slider',{name:'Fieldstrip progress'});
 await explode.focus();await explode.press('End');
 await page.waitForFunction(rest=>{const n=window.__PRINTSTREAM__.model.getObjectByName('Stock');n.updateWorldMatrix(true,false);return n.getWorldPosition(n.position.clone()).toArray().some((v,i)=>Math.abs(v-rest[i])>.1);},rest[0]);
 assert(true,'Inspect: keyboard range End explodes the actual model');
 await explode.press('Home');
 await page.waitForFunction(rest=>{const e=window.__PRINTSTREAM__;e.model.updateWorldMatrix(true,true);return['Stock','StockLever','ButtPad'].every((name,i)=>{const n=e.model.getObjectByName(name);return n.getWorldPosition(n.position.clone()).toArray().every((v,j)=>Math.abs(v-rest[i][j])<.001);});},rest);
 assert(true,'Inspect: keyboard range Home reassembles the actual model');
 await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
 assert(!(await state(page)).inspect,'Inspect: Escape closes the modal');
 await page.locator('.header-inspect').click();await panel.waitFor({state:'visible'});
 assert((await state(page)).inspect,'Inspect: header button reopens the studio');
}
try{
 if(inputsOnly){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({type:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')report.errors.push({type:m.type(),message:m.text()});});
  await page.goto(`${URL}/?verify=1`,{waitUntil:'networkidle',timeout:120000});
  await page.waitForFunction(()=>window.__PRINTSTREAM__?.ready,null,{timeout:120000});
  await api(page,'enterInspect');await page.getByRole('dialog').waitFor();
  await verifyInspectInputs(page);await context.close();
  assert(report.errors.length===0,'Inspect: no browser errors or warnings');report.success=true;
 }else{
 for(const device of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1,isMobile:device.name==='mobile',hasTouch:device.name==='mobile'});
  await context.addInitScript(()=>{
   window.__shaderDiagnostics=[];
   const original=WebGL2RenderingContext.prototype.linkProgram;
   WebGL2RenderingContext.prototype.linkProgram=function(program){
    original.call(this,program);const log=this.getProgramInfoLog(program);
    if(log?.trim()){const debug=this.getExtension('WEBGL_debug_shaders');window.__shaderDiagnostics.push({log,shaders:this.getAttachedShaders(program).map(shader=>({source:this.getShaderSource(shader),translated:debug?.getTranslatedShaderSource(shader)}))});}
   };
  });
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({device:device.name,type:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')report.errors.push({device:device.name,type:m.type(),message:m.text()});});
  page.on('response',response=>{if(response.status()>=400)report.errors.push({device:device.name,type:'http',message:`${response.status()} ${response.url()}`});});
  await page.goto(`${URL}/?verify=1`,{waitUntil:'networkidle',timeout:120000});
  await page.waitForFunction(()=>window.__PRINTSTREAM__?.ready,null,{timeout:120000});
  await page.evaluate(()=>document.fonts.ready); await frames(page,30);
  report.shaderDiagnostics=await page.evaluate(()=>window.__shaderDiagnostics);
  assert((await state(page)).ready,`${device.name}: GLB loaded and assembly completed`);
  assert((await state(page)).error===null,`${device.name}: successful WebGL creation leaves no stale error`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${device.name}: no horizontal document overflow`);
  await snap(page,device.name,'01-hero'); await measure(page,device.name+' / hero');
  // Scroll through actual chapter controls. Hold a reached mechanical pose for visual evidence.
  for(const [chapter,action,pose,name] of [['suppressor','suppressor',1,'04-suppressor-off'],['receiver','chargingHandle',1,'05-charging-back'],['magazine','magazine',1,'06-magazine-out'],['stock','stock',1,'07-stock-extended']]){
   await page.locator(`#${chapter}`).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
   await page.waitForFunction(id=>window.__PRINTSTREAM__.getState().chapter===id,chapter,{timeout:20000});
   await cameraSettled(page);
   const partName={suppressor:'Suppressor',chargingHandle:'ChargingHandle',magazine:'Magazine',stock:'Stock'}[action];
   const original=await page.evaluate(name=>window.__PRINTSTREAM__.model.getObjectByName(name).position.toArray(),partName);
   if(action==='stock'){
    const slider=page.locator('#stock input[aria-label="Stock position"]');
    await slider.focus(); await slider.press('End');
    await page.waitForFunction(({name,original})=>window.__PRINTSTREAM__.model.getObjectByName(name).position.toArray().some((v,i)=>Math.abs(v-original[i])>.001),{name:partName,original});
    assert(true,`${device.name}: stock slider moves the actual stock mesh`);
    await api(page,'setMechanical','stock',1,{immediate:true});
   }else{
    await page.locator(`#${chapter} [data-action="${action}"]`).click();
    await page.waitForFunction(({name,original})=>window.__PRINTSTREAM__.model.getObjectByName(name).position.toArray().some((v,i)=>Math.abs(v-original[i])>.001),{name:partName,original});
    assert(true,`${device.name}: ${action} button moves its actual component`);
    await api(page,'setMechanical',action,pose,{immediate:true});
   }
   assert((await state(page)).mechanical[action]>.95,`${device.name}: ${action} reaches its operated state`);
   await snap(page,device.name,name);
   await api(page,'setMechanical',action,0,{immediate:true});
  }
  await page.locator('#finish').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.waitForFunction(()=>window.__PRINTSTREAM__.getState().chapter==='finish');await cameraSettled(page);
  const lightSlider=page.locator('#finish').getByRole('slider',{name:'Studio light angle'});const lightBox=await lightSlider.boundingBox();
  await lightSlider.click({position:{x:lightBox.width*.25,y:lightBox.height/2}});
  await page.waitForFunction(()=>window.__PRINTSTREAM__.getState().light<-60);await frames(page,45);
  assert((await state(page)).light<-60,`${device.name}: finish slider turns the key light negative`);
  await snap(page,device.name,'10-finish-light-a');
  await lightSlider.click({position:{x:lightBox.width*.75,y:lightBox.height/2}});
  await page.waitForFunction(()=>window.__PRINTSTREAM__.getState().light>60);await frames(page,45);
  assert((await state(page)).light>60,`${device.name}: finish slider turns the key light positive`);
  await snap(page,device.name,'11-finish-light-b');
  await api(page,'enterInspect');await page.getByRole('dialog').waitFor();
  await api(page,'preset','left',{immediate:true});await snap(page,device.name,'02-left-profile');
  const hit=await page.evaluate(()=>{const api=window.__PRINTSTREAM__;const p=api.camera.position.clone().set(-.8,0,.218);api.model.getObjectByName('Suppressor').localToWorld(p);p.project(api.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};});
  await page.mouse.move(hit.x,hit.y);await page.waitForFunction(()=>window.__PRINTSTREAM__.getState().hovered==='Suppressor');
  assert((await state(page)).hovered==='Suppressor',`${device.name}: raycast mesh hover activates named-part rim`);
  await snap(page,device.name,'02b-mesh-hover');
  await page.mouse.click(hit.x,hit.y);await cameraSettled(page);
  assert((await state(page)).selected==='Suppressor',`${device.name}: mesh click selects and frames its part`);
  await api(page,'preset','left',{immediate:true});
  await page.getByRole('button',{name:'Inspect Suppressor',exact:true}).click();await cameraSettled(page);
  assert((await state(page)).selected==='Suppressor',`${device.name}: occlusion-aware hotspot opens its part card`);
  await api(page,'selectPart','Handguard_Top');await cameraSettled(page);await snap(page,device.name,'03-handguard-closeup');
  await api(page,'preset','closeup',{immediate:true});await snap(page,device.name,'03b-receiver-closeup');
  if(device.name==='desktop'){
   await api(page,'setMechanical','dustCover',0,{immediate:true});
   await api(page,'setMechanical','selector',0,{immediate:true});
   const rotation=name=>page.evaluate(n=>window.__PRINTSTREAM__.model.getObjectByName(n).quaternion.toArray(),name);
   const operated=[['dustCover','DustCover'],['selector','SelectorLever'],['trigger','Trigger']];
   const restRotations={};
   for(const [action,part] of operated){
    restRotations[part]=await rotation(part);
    await page.locator(`.mechanical-controls [data-action="${action}"]`).click();
    await page.waitForFunction(({part,rest})=>window.__PRINTSTREAM__.model.getObjectByName(part).quaternion.toArray().some((v,i)=>Math.abs(v-rest[i])>.001),{part,rest:restRotations[part]});
    assert(true,`Desktop: visible ${action} control rotates its actual component`);
    if(action==='trigger')await page.waitForFunction(()=>window.__PRINTSTREAM__.getState().mechanical.trigger<.001);
   }
   if(!(await state(page)).hotspots)await page.getByRole('button',{name:'Labels',exact:true}).click();
   await page.getByRole('button',{name:'Labels',exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.model-label')].every(el=>getComputedStyle(el).visibility==='hidden'));
   assert(true,'Desktop: Labels control hides the rendered annotations');
   await page.getByRole('button',{name:'Labels',exact:true}).click();
   const cameraBefore=(await state(page)).cameraPosition;
   await page.getByRole('button',{name:'Auto rotate',exact:true}).click();await frames(page,45);
   assert((await state(page)).cameraPosition.some((v,i)=>Math.abs(v-cameraBefore[i])>.01),'Desktop: Auto rotate visibly moves the camera');
   await page.getByRole('button',{name:'Auto rotate',exact:true}).click();
   await page.locator('.parts-index > summary').click();
   await page.locator('.parts-index').getByRole('button',{name:'Barrel',exact:true}).click();await cameraSettled(page);
   assert((await state(page)).selected==='Barrel'&&await page.getByRole('complementary',{name:'Selected part'}).isVisible(),'Desktop: All parts index focuses the selected component and opens its card');
   await page.getByRole('button',{name:'Close part detail'}).click();
   assert(!(await page.getByRole('complementary',{name:'Selected part'}).isVisible()),'Desktop: selected part card closes');
   await page.locator('.parts-index > summary').click();
   await page.getByRole('button',{name:'Reset',exact:true}).click();await cameraSettled(page);
   for(const [action,part] of operated)assert((await rotation(part)).every((v,i)=>Math.abs(v-restRotations[part][i])<.0001),`Desktop: Reset restores the actual ${action} pose`);
   await frames(page,2);
   const stockRest=await page.evaluate(()=>{const stock=window.__PRINTSTREAM__.model.getObjectByName('Stock');stock.updateWorldMatrix(true,false);return stock.getWorldPosition(stock.position.clone()).toArray();});
   await page.locator('.fieldstrip-button').click();
   await page.waitForFunction(()=>{const s=window.__PRINTSTREAM__.getState();return s.explode>.999&&!s.exploding;});
   assert(await page.evaluate(rest=>{const stock=window.__PRINTSTREAM__.model.getObjectByName('Stock');stock.updateWorldMatrix(true,false);return stock.getWorldPosition(stock.position.clone()).toArray().some((v,i)=>Math.abs(v-rest[i])>.1);},stockRest),'Desktop: visible Fieldstrip control separates the actual stock');
   await page.locator('.fieldstrip-button').click();
   await page.waitForFunction(()=>{const s=window.__PRINTSTREAM__.getState();return s.explode<.001&&!s.exploding;});
   await page.waitForFunction(rest=>{const stock=window.__PRINTSTREAM__.model.getObjectByName('Stock');stock.updateWorldMatrix(true,false);return stock.getWorldPosition(stock.position.clone()).toArray().every((v,i)=>Math.abs(v-rest[i])<.0001);},stockRest);
   assert(true,'Desktop: visible Reassemble control restores its rendered world position');
   await verifyInspectInputs(page);
   await api(page,'preset','closeup',{immediate:true});
  }
  for(const progress of [.5,1]){
   await api(page,'setExplode',progress,{immediate:true});await frames(page,45);
   assert(Math.abs((await state(page)).explode-progress)<.01,`${device.name}: exploded scrub reaches ${progress}`);
   await snap(page,device.name,progress===.5?'08-exploded-half':'09-exploded-full');
   const labels=(await state(page)).labels;
   const collisions=labels.flatMap((a,i)=>labels.slice(i+1).filter(b=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y).map(b=>[a.name,b.name]));
   assert(collisions.length===0,`${device.name}: exploded ${progress} labels do not overlap`);
  }
  const denied=await api(page,'action','suppressor');
  assert(denied?.ok===false,`${device.name}: mechanical action is rejected while exploded`);
  if(device.name==='mobile') await page.locator('.inspect-controls-sheet > summary').click();
  assert(await page.getByText('Reassemble to operate.',{exact:true}).isVisible(),`${device.name}: unavailable action has visible explanation`);
  if(device.name==='mobile') await page.locator('.inspect-controls-sheet > summary').click();
  await api(page,'setExplode',0,{immediate:true});await api(page,'preset','right',{immediate:true});
  await api(page,'setMechanical','dustCover',1,{immediate:true});await api(page,'setMechanical','chargingHandle',1,{immediate:true});await snap(page,device.name,'12-right-port-open');
  await api(page,'setMechanical','chargingHandle',0,{immediate:true});await api(page,'setMechanical','dustCover',0,{immediate:true});
  await api(page,'preset','hero',{immediate:true});await cameraSettled(page);
  if(device.name==='mobile') await page.locator('.inspect-controls-sheet > summary').click();
  await page.getByRole('button',{name:'CS2 Inspect',exact:true}).click();
  assert((await state(page)).motion,`${device.name}: visible CS2 Inspect control starts the motion`);
  if(device.name==='mobile') await page.locator('.inspect-controls-sheet > summary').click();
  await page.waitForFunction(()=>!window.__PRINTSTREAM__.getState().motion,null,{timeout:15000});
  await api(page,'inspectMotion',{progress:.5});await frames(page);
  assert(await page.evaluate(()=>{const api=window.__PRINTSTREAM__;api.model.updateWorldMatrix(true,true);const x=name=>{const part=api.model.getObjectByName(name);return part.getWorldPosition(part.position.clone()).project(api.camera).x;};return x('Suppressor')>x('Stock');}),`${device.name}: inspect midpoint exposes the actual right side`);
  await snap(page,device.name,'13-cs2-inspect-mid');
  await api(page,'action','reset');await page.waitForFunction(()=>!window.__PRINTSTREAM__.getState().motion);await cameraSettled(page);
  let heroDistance=0;
  for(const preset of ['hero','left','right','top','muzzle','closeup']){
   await api(page,'preset',preset,{immediate:true});await frames(page);
   const camera=await state(page),d=camera.cameraPosition.map((v,i)=>v-camera.cameraTarget[i]),distance=Math.hypot(...d);
   if(preset==='hero')heroDistance=distance;
   const valid={
    hero:d[0]<0&&d[1]>0&&d[2]>0,
    left:d[2]>5*Math.max(Math.abs(d[0]),Math.abs(d[1])),
    right:-d[2]>5*Math.max(Math.abs(d[0]),Math.abs(d[1])),
    top:d[1]>5*Math.max(Math.abs(d[0]),Math.abs(d[2])),
    muzzle:-d[0]>3*Math.max(Math.abs(d[1]),Math.abs(d[2])),
    closeup:distance<heroDistance*.7&&camera.cameraTarget[0]>.3&&camera.cameraTarget[0]<2.4,
   }[preset];
   assert(valid,`${device.name}: ${preset} preset reaches its actual viewing direction and scale`);
  }
  await api(page,'preset','hero',{immediate:true});
  // Real mouse/touch events exercise OrbitControls, not the camera preset API.
  const before=(await state(page)).cameraPosition;
  if(device.name==='mobile'){
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:210,y:210,id:1}]});
   for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:210+i*5,y:210+i*3,id:1}]});await frames(page,1);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{
   await page.mouse.move(device.width*.55,device.height*.25);await page.mouse.down();await page.mouse.move(device.width*.65,device.height*.30,{steps:12});await page.mouse.up();
  }
  await frames(page,25);const after=(await state(page)).cameraPosition;
  assert(before.some((v,i)=>Math.abs(v-after[i])>.01),`${device.name}: ${device.name==='mobile'?'touch':'pointer'} orbit changes camera position`);
  if(device.name==='desktop'){
   const beforeZoom=await state(page);
   await page.mouse.wheel(0,300);await cameraSettled(page);const afterZoom=await state(page);
   const distance=s=>Math.hypot(...s.cameraPosition.map((v,i)=>v-s.cameraTarget[i]));
   assert(Math.abs(distance(beforeZoom)-distance(afterZoom))>.1,'Desktop: wheel zoom changes camera distance');
   const target=afterZoom.cameraTarget;
   await page.mouse.down({button:'right'});await page.mouse.move(device.width*.6,device.height*.33,{steps:10});await page.mouse.up({button:'right'});await cameraSettled(page);
   assert((await state(page)).cameraTarget.some((v,i)=>Math.abs(v-target[i])>.01),'Desktop: right-button pan moves the orbit target');
  }
  await page.getByRole('button',{name:'Close inspect mode'}).click();assert(!(await state(page)).inspect,`${device.name}: inspect mode exits through its visible control`);
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:2560,height:1440},deviceScaleFactor:1});const page=await context.newPage();await page.goto(URL,{waitUntil:'networkidle',timeout:120000});await page.waitForFunction(()=>window.__PRINTSTREAM__?.ready,null,{timeout:120000});await frames(page,60);await measure(page,'desktop / 2560×1440 / live idle');await context.close();
 const performance1440=report.measurements.at(-1);
 assert(performance1440.fps>=55,'2560×1440: measured frame rate reaches 55 FPS');
 assert(performance1440.maxDrawCalls<=150,'2560×1440: full rendered frame stays within 150 draw calls');
 assert(performance1440.maxTriangles<=300000,'2560×1440: rendered geometry remains within triangle budget');
 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const rp=await reduced.newPage();await rp.goto(`${URL}/?verify=1`,{waitUntil:'networkidle',timeout:120000});await rp.waitForFunction(()=>window.__PRINTSTREAM__?.ready,null,{timeout:120000});assert((await state(rp)).reducedMotion,'Reduced-motion preference reaches the animation owner');await reduced.close();
 const request=await browser.newContext();
 for(const file of ['/models/m4a1s-printstream.glb','/downloads/m4a1s-printstream.blend','/downloads/renders.zip','/licenses/Space-Grotesk-OFL.txt','/licenses/IBM-Plex-Mono-OFL.txt']){
  const response=await request.request.head(URL+file);assert(response.ok(),`Download responds: ${file}`);
 }
 await request.close();
 assert(report.errors.length===0,'Browser console has no errors or warnings');
 report.glbBytes=(await stat(path.join(ROOT,'public/models/m4a1s-printstream.glb'))).size;
 report.success=true;
 }
}catch(error){report.success=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await writeFile(path.join(ROOT,inputsOnly?'artifacts/inspect-inputs-verification.json':'artifacts/browser-verification.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({success:report.success,checks:report.checks.length,screenshots:report.screens.length,errors:report.errors,measurements:report.measurements.map(m=>({label:m.label,fps:m.fps,triangles:m.state.stats.triangles,drawCalls:m.state.stats.drawCalls,loadMs:m.state.stats.loadMs,renderer:m.renderer})),failure:report.failure},null,2));}
