import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
function makeHarness(){
 const start=source.indexOf('function confirmInApp('),end=source.indexOf('function nav(',start);
 assert.ok(start>=0&&end>start);
 const events=new Map(),buttonEvents=new Map();
 const dialog={
  className:'',open:false,returnValue:'',removed:false,innerHTML:'',
  setAttribute(){},
  addEventListener(type,callback){events.set(type,callback);},
  querySelector(selector){
   if(selector==='[data-dialog-cancel]')return {addEventListener:(type,cb)=>buttonEvents.set(type,cb)};
   if(selector==='form')return {};
   return null;
  },
  showModal(){this.open=true;},
  close(value=''){this.returnValue=value;this.open=false;events.get('close')?.();},
  remove(){this.removed=true;}
 };
 const fakeDocument={createElement:()=>dialog,body:{append:()=>{}}};
 const fakeFormData=class{constructor(){this.entries=[['title','Example']]} [Symbol.iterator](){return this.entries[Symbol.iterator]()}};
 const fn=vm.runInNewContext(source.slice(start,end)+'\nconfirmInApp',{document:fakeDocument,FormData:fakeFormData,esc:x=>String(x)});
 return {fn,dialog,events,buttonEvents};
}

test('Cancel is explicitly non-submitting, even with required fields',async()=>{
 const h=makeHarness();
 const result=h.fn({title:'Editar orientação',fields:'<input name="title" required minlength="3"><textarea name="body" required></textarea>'});
 assert.equal(h.dialog.open,true);
 assert.match(h.dialog.innerHTML,/type="button" data-dialog-cancel/);
 assert.doesNotMatch(h.dialog.innerHTML,/type="submit" value="cancel"/);
 h.buttonEvents.get('click')();
 assert.equal(await result,null);
 assert.equal(h.dialog.open,false);
 assert.equal(h.dialog.removed,true);
});
test('Escape closes a training edit dialog without confirming changes',async()=>{
 const h=makeHarness();
 const result=h.fn({title:'Excluir orientação',fields:'<input name="title" required>'});
 h.events.get('cancel')();
 h.dialog.close('cancel');
 assert.equal(await result,null);
 assert.equal(h.dialog.removed,true);
});
test('the training review provides Edit and Delete for private, approved, shared and material cards',()=>{
 assert.match(source,/data-action="training-review-edit"/);
 assert.match(source,/data-action="training-review-delete"/);
 assert.match(source,/data-action="training-review-copy"/);
 assert.match(source,/data-action="training-review-hide-shared"/);
 assert.match(source,/data-action="training-proof-edit"/);
 assert.match(source,/data-action="training-proof-remove"/);
 assert.match(source,/data-action="training-review-restore-shared"/);
});
