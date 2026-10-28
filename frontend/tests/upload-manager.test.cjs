const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {webcrypto,createHash}=require('node:crypto');
const {File}=require('node:buffer');

function setup(options={}){
 let task=options.task,creates=0,completes=0,cancels=0;
 const parts=[];let entered;
 const entering=new Promise(r=>{entered=r;});
 const clone=value=>JSON.parse(JSON.stringify(value));
 const api={
  async get(url){if(url.endsWith('/policy'))return {data:{limits_mb:{storage:2048,knowledge:10,image:20,attachment:200,log:20,video:2048}}};if(url==='/api/v1/uploads')return {data:task?[clone(task)]:[]};return {data:clone(task)};},
  async post(url,body){
   if(url.endsWith('/complete')){completes++;task.status='complete';task.entry_id='file-id';if(options.lostComplete)throw Error('lost response');return {data:clone(task)};}
   creates++;task={id:body.upload_id,filename:body.filename,size:body.size,space:'personal/user',parent:'',purpose:'storage',status:'active',chunk_size:8,parts:[],fingerprint:body.fingerprint,entry_id:null,context:{}};
   return {data:clone(task)};
  },
  async put(url,chunk,config){
   const index=Number(url.split('/').pop());parts.push(index);
   task.parts.push({size:chunk.size,sha256:config.params.sha256});
   config.onUploadProgress?.({loaded:chunk.size,total:chunk.size});
   if(options.pauseFirst&&parts.length===1){entered();await new Promise((ok,fail)=>{config.signal.addEventListener('abort',()=>fail(Error('aborted')),{once:true});});}
   return {data:clone(task)};
  },
  async delete(){cancels++;task.status='cancelled';return {data:clone(task)};},
 };
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/lib/upload-manager.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='@/lib/api'?{default:api}:{errorMessage:e=>e.message},crypto:webcrypto,File,Blob,AbortController,DOMException,TextEncoder,Date,Event,window:{dispatchEvent(){}},setTimeout});
 return {manager:exports.uploadManager,parts,entering,task:()=>task,counts:()=>({creates,completes,cancels})};
}
function until(fn){return new Promise((resolve,reject)=>{const deadline=Date.now()+3000;function check(){if(fn())resolve();else if(Date.now()>deadline)reject(Error('state timeout'));else setTimeout(check,5);}check();});}
test('global queue survives route-independent subscriptions and resolves only after finalize',async()=>{
 const h=setup();const file=new File(['abcdefghijklmnopqrst'],'data.txt',{lastModified:123});
 const upload=h.manager.enqueue(file,{purpose:'storage'});
 const unsubscribe=h.manager.subscribe(()=>{});unsubscribe();
 const result=await upload.promise;
 assert.equal(result.status,'complete');assert.deepEqual(h.parts,[0,1,2]);assert.equal(h.manager.snapshot()[0].percent,100);assert.deepEqual(h.counts(),{creates:1,completes:1,cancels:0});
});
test('pause keeps received chunks and resume verifies them without retransmitting',async()=>{
 const h=setup({pauseFirst:true});const upload=h.manager.enqueue(new File(['abcdefghijklmnopqrst'],'data.txt',{lastModified:123}),{purpose:'storage'});
 await h.entering;h.manager.pause(upload.key);
 await until(()=>h.manager.snapshot()[0].phase==='paused');
 h.manager.resume(upload.key);await upload.promise;
 assert.deepEqual(h.parts,[0,1,2]);assert.equal(h.counts().creates,1);assert.equal(h.counts().cancels,0);
});
test('a lost completion response is reconciled from server status without another file',async()=>{
 const h=setup({lostComplete:true});await h.manager.enqueue(new File(['hello'],'data.txt'),{purpose:'storage'}).promise;
 assert.equal(h.manager.snapshot()[0].phase,'complete');assert.equal(h.counts().creates,1);assert.equal(h.counts().completes,1);
});
test('restored uploads require the original file and reject a mismatching uploaded prefix',async()=>{
 const file=new File(['abcdefghijklmnopqrst'],'data.txt',{lastModified:123});
 const fingerprint=createHash('sha256').update(Buffer.concat([Buffer.from(file.name),Buffer.from(String(file.size)),Buffer.from(String(file.lastModified)),Buffer.from(await file.arrayBuffer()),Buffer.from(await file.arrayBuffer())])).digest('hex');
 const task={id:'old-task',filename:file.name,size:file.size,space:'personal/user',parent:'',purpose:'storage',status:'active',chunk_size:8,parts:[{size:8,sha256:'0'.repeat(64)}],fingerprint,entry_id:null,context:{}};
 const h=setup({task});await h.manager.bind('user');assert.equal(h.manager.snapshot()[0].needsFile,true);
 h.manager.resume('old-task',file);await until(()=>h.manager.snapshot()[0].phase==='error');
 assert.deepEqual(h.parts,[]);assert.equal(h.counts().completes,0);
});
