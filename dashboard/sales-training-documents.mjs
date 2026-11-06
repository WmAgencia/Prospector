// Companion Markdown files kept inside each tenant's PROSPECTOR_DATA_DIR.
// The approved social evidence and closing policy are not shared across tenants.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','training');
const files=Object.freeze({proofs:'francisca-provas-sociais.md',closing:'francisca-fechamento.md'});
function fileFor(kind){if(!Object.hasOwn(files,kind))throw Error('UNSUPPORTED_SALES_DOCUMENT');return path.join(root,files[kind]);}
export function saveSalesContextMarkdown(kind,content){
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 if(fs.lstatSync(root).isSymbolicLink())throw Error('UNSAFE_TENANT_DIRECTORY');
 const text=String(content||'').trim().slice(0,19000)+'\n';
 const to=fileFor(kind),temp=path.join(root,'.'+crypto.randomUUID()+'.md');
 try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.renameSync(temp,to);fs.chmodSync(to,0o600);}
 finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {filename:files[kind],bytes:Buffer.byteLength(text)};
}
export function readSalesContextMarkdown(kind){
 const filename=fileFor(kind);
 try{
  if(fs.lstatSync(root).isSymbolicLink())throw Error('UNSAFE_TENANT_DIRECTORY');
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20000)throw Error('INVALID_SALES_DOCUMENT');
  return fs.readFileSync(filename,'utf8');
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export const salesContextFilename=kind=>files[kind]||null;
