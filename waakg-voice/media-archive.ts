// Private WA-AKG media archive. Message URLs remain /api/media/<filename>
// and pass the existing per-session authorization before any cloud fetch.
// Every local file is deleted ONLY after a successful S3 upload + HEAD match.
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {readdir,stat,statfs,unlink} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import path from "node:path";

const directory=path.resolve(process.cwd(),"data","media");
const validName=/^[A-Za-z0-9_-]{3,170}\.[A-Za-z0-9]{2,10}$/;
const prefix="wa-akg-media/";
const configured=()=>process.env.WA_MEDIA_ARCHIVE_ENABLED==="true"&&
 !!process.env.WA_MEDIA_S3_ENDPOINT&&!!process.env.WA_MEDIA_S3_BUCKET&&
 !!process.env.WA_MEDIA_S3_ACCESS_KEY_ID&&!!process.env.WA_MEDIA_S3_SECRET_ACCESS_KEY;
const key=name=>prefix+name;
let client:S3Client|null=null;
const bucket=()=>process.env.WA_MEDIA_S3_BUCKET||"";
function connection():S3Client{
 if(!configured())throw new Error("MEDIA_ARCHIVE_UNCONFIGURED");
 if(!client)client=new S3Client({
  endpoint:process.env.WA_MEDIA_S3_ENDPOINT,
  region:process.env.WA_MEDIA_S3_REGION||"auto",
  forcePathStyle:process.env.WA_MEDIA_S3_URL_STYLE==="path",
  credentials:{accessKeyId:process.env.WA_MEDIA_S3_ACCESS_KEY_ID||"",secretAccessKey:process.env.WA_MEDIA_S3_SECRET_ACCESS_KEY||""},
  maxAttempts:2
 });
 return client;
}
async function verified(name:string,bytes:number,digest:string){
 const head=await connection().send(new HeadObjectCommand({Bucket:bucket(),Key:key(name)}),{abortSignal:AbortSignal.timeout(25000)});
 if(Number(head.ContentLength)!==bytes||head.Metadata?.sha256!==digest)throw new Error("MEDIA_ARCHIVE_INTEGRITY_MISMATCH");
}
export async function saveToArchive(filename:string,buffer:Buffer):Promise<boolean>{
 if(!configured())return false;
 if(!validName.test(filename)||!Buffer.isBuffer(buffer)||buffer.length<100||buffer.length>60*1024*1024)
  throw new Error("MEDIA_ARCHIVE_INVALID_FILE");
 try{
  await connection().send(new PutObjectCommand({
   Bucket:bucket(),Key:key(filename),Body:buffer,ContentType:"application/octet-stream",ContentLength:buffer.length,Metadata:{sha256:createHash("sha256").update(buffer).digest("hex")}
  }),{abortSignal:AbortSignal.timeout(35000)});
  await verified(filename,buffer.length,createHash("sha256").update(buffer).digest("hex"));
  return true;
 }catch(error:any){
  console.warn("[media archive] live upload failed",String(error?.name||"ERROR").slice(0,50));
  return false; // fallback to local cache, without losing original media
 }
}
export async function fetchFromArchive(filename:string):Promise<Buffer|null>{
 if(!configured()||!validName.test(filename))return null;
 try{
  const response=await connection().send(new GetObjectCommand({Bucket:bucket(),Key:key(filename)}),{abortSignal:AbortSignal.timeout(30000)});
  const length=Number(response.ContentLength||0);
  if(length>60*1024*1024)throw new Error("MEDIA_ARCHIVE_TOO_LARGE");
  const bytes=await response.Body?.transformToByteArray();
  if(!bytes||bytes.length<100||bytes.length>60*1024*1024)throw new Error("MEDIA_ARCHIVE_INVALID_RESPONSE");
  return Buffer.from(bytes);
 }catch(error:any){
  if(["NoSuchKey","NotFound","NoSuchBucket"].includes(String(error?.name)))return null;
  console.warn("[media archive] read failed",String(error?.name||"ERROR").slice(0,60));
  throw error;
 }
}
type Batch={scanned:number,archived:number,removedBytes:number,failed:number,freeMB:number|null,enabled:boolean};
let processing=false;
export async function archiveLocalMedia({batchLimit=85,minimumAgeMs=120000}={}):Promise<Batch>{
 if(!configured())return {scanned:0,archived:0,removedBytes:0,failed:0,freeMB:null,enabled:false};
 if(processing)return {scanned:0,archived:0,removedBytes:0,failed:0,freeMB:null,enabled:true};
 processing=true;
 const result:Batch={scanned:0,archived:0,removedBytes:0,failed:0,freeMB:null,enabled:true};
 try{
  const entries=(await readdir(directory,{withFileTypes:true})).filter(x=>x.isFile()&&validName.test(x.name));
  // Oldest media first. No deletion if upload verification fails.
  const files=await Promise.all(entries.map(async x=>{
   const file=path.join(directory,x.name);
   try{return {name:x.name,file,info:await stat(file)};}catch{return null;}
  }));
  const candidates=files.filter((x):x is NonNullable<typeof x>=>!!x&&Date.now()-x.info.mtimeMs>=minimumAgeMs)
   .sort((a,b)=>a.info.mtimeMs-b.info.mtimeMs).slice(0,Math.min(300,Math.max(1,batchLimit)));
  for(const item of candidates){
   result.scanned++;
   try{
    const size=item.info.size;
    if(size<100||size>60*1024*1024){result.failed++;continue;}
    // Hash each local file; unchanged size alone is not proof of integrity.
    const hash=createHash("sha256");
    for await(const part of createReadStream(item.file))hash.update(part);
    const digest=hash.digest("hex");
    const old=await connection().send(new HeadObjectCommand({Bucket:bucket(),Key:key(item.name)}),{abortSignal:AbortSignal.timeout(20000)}).catch(()=>null);
    if(Number(old?.ContentLength)!==size||old?.Metadata?.sha256!==digest){
     await connection().send(new PutObjectCommand({Bucket:bucket(),Key:key(item.name),Body:createReadStream(item.file),ContentType:"application/octet-stream",ContentLength:size,Metadata:{sha256:digest}}),{abortSignal:AbortSignal.timeout(90000)});
    }
    await verified(item.name,size,digest);
    const current=await stat(item.file).catch(()=>null);
    if(!current||current.size!==size||current.mtimeMs!==item.info.mtimeMs)continue;
    await unlink(item.file);
    result.archived++;result.removedBytes+=size;
   }catch(e:any){
    result.failed++;
    if(result.failed>=4){
     console.warn("[media archive] batch stopped after errors",String(e?.name||"ERROR").slice(0,60));
     break;
    }
   }
  }
  try{const space=await statfs(directory);result.freeMB=Math.round(space.bavail*space.bsize/1024/1024);}catch{}
  return result;
 }finally{processing=false;}
}
let started=false;
export function startMediaArchiveWorker(){
 if(started)return;
 started=true;
 if(!configured()){console.warn("[media archive] disabled: storage configuration incomplete");return;}
 const run=()=>archiveLocalMedia().then(s=>{
  if(s.archived||s.failed)console.info("[media archive]",JSON.stringify(s));
 }).catch(e=>console.warn("[media archive] worker error",String(e?.name||"ERROR").slice(0,80)));
 setTimeout(run,12000).unref();
 setInterval(run,25000).unref();
 console.info("[media archive] private object storage enabled; migrating verified files");
}
