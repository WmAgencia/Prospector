// Local Markdown is the authoritative approved training artifact for THIS workspace.
// PROSPECTOR_DATA_DIR is set by the platform per client, never from a request.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data');
const directory=path.join(root,'training');
const files=Object.freeze({draft:'francisca-rascunho.md',active:'francisca.md'});
const LIMIT=18000;
function ensureDirectory(){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('TRAINING_STORAGE_LINK_NOT_ALLOWED');
}
function fileFor(kind){
 const name=files[kind];
 if(!name)throw Error('TRAINING_FILE_KIND_INVALID');
 return path.join(directory,name);
}
function safeText(text){
 const body=String(text||'').replace(/\r\n?/g,'\n').trim();
 if(body.length<20||body.length>LIMIT)throw Error('Perfil Markdown inválido (20 a 18.000 caracteres)');
 return body+'\n';
}
export function storeTrainingMarkdown(kind,content){
 ensureDirectory();
 const destination=fileFor(kind);
 const body=safeText(content);
 const temporary=path.join(directory,'.tmp-'+crypto.randomUUID()+'.md');
 try{
  fs.writeFileSync(temporary,body,{encoding:'utf8',mode:0o600,flag:'wx'});
  fs.renameSync(temporary,destination);
  fs.chmodSync(destination,0o600);
 }finally{
  try{fs.unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return {filename:files[kind],bytes:Buffer.byteLength(body,'utf8'),
  sha256:crypto.createHash('sha256').update(body).digest('hex')};
}
export function readTrainingMarkdown(kind){
 const filename=fileFor(kind);
 try{
  if(fs.lstatSync(directory).isSymbolicLink())throw Error('TRAINING_STORAGE_LINK_NOT_ALLOWED');
  const info=fs.lstatSync(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.size>LIMIT*4)throw Error('TRAINING_DOCUMENT_INVALID');
  const content=fs.readFileSync(filename,'utf8');
  if(content.length>LIMIT+1)throw Error('TRAINING_DOCUMENT_TOO_LONG');
  return content;
 }catch(error){
  if(error.code==='ENOENT')return null;
  throw error;
 }
}
export function removeTrainingMarkdown(kind){
 try{fs.unlinkSync(fileFor(kind));return true;}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export const trainingMarkdownName=kind=>files[kind]||null;
export const trainingMarkdownStorage=()=>({tenantId:process.env.PROSPECTOR_TENANT_ID||null,
 directory,root});
