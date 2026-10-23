const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('src/lib/floating-window.ts','utf8');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {fitWindow,resizeWindow,centerWindow}=exportsObject;

test('opening centers the fitted window on desktop and narrow screens',()=>{
 for(const viewport of [{width:1440,height:960},{width:320,height:568},{width:375,height:300}]) {
  const rect=centerWindow({width:720,height:420},viewport);
  assert.equal(rect.x+rect.width/2,viewport.width/2);
  assert.equal(rect.y+rect.height/2,viewport.height/2);
  assert.ok(rect.x>=8);assert.ok(rect.y>=8);
 }
});
test('small viewports keep title and all resize edges reachable',()=>{
 const rect=fitWindow({x:900,y:900,width:720,height:420},{width:320,height:568});
 assert.equal(rect.width,304);assert.equal(rect.x,8);assert.equal(rect.y,140);
});
test('west resize preserves right edge and enforces minimum width',()=>{
 const rect=resizeWindow({x:100,y:100,width:600,height:400},'w',1000,0,{width:1440,height:900});
 assert.equal(rect.x,420);assert.equal(rect.width,280);assert.equal(rect.x+rect.width,700);
});
test('corner resize remains within viewport',()=>{
 const rect=resizeWindow({x:100,y:100,width:600,height:400},'se',2000,2000,{width:1000,height:700});
 assert.equal(rect.width,892);assert.equal(rect.height,592);
});
test('north-west resize cannot move past screen edges',()=>{
 const rect=resizeWindow({x:100,y:100,width:600,height:400},'nw',-2000,-2000,{width:1000,height:700});
 assert.equal(rect.x,8);assert.equal(rect.y,8);assert.equal(rect.width,692);assert.equal(rect.height,492);
});
test('viewport changes shrink an existing window without moving it off screen',()=>{
 const rect=fitWindow({x:1000,y:600,width:700,height:400},{width:375,height:300});
 assert.equal(rect.x,8);assert.equal(rect.y,8);assert.equal(rect.width,359);assert.equal(rect.height,284);
});
