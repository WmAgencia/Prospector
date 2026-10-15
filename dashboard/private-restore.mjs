// Importação única de mídia privada da conta do proprietário.
// PROSPECTOR_MEDIA_RESTORE_URL é URL temporária com acesso ao arquivo de plugin privado.
// NÃO imprimir URL, NÃO devolver mídia, NÃO alterar autorização de contatos.
import {gunzipSync} from 'node:zlib';
import {getSetting,setSetting,audit} from './db.mjs';
import {importCampaignPackage} from './campaign-package.mjs';
const MAX_TRANSFER=30*1024*1024,MAX_TAR=40*1024*1024;
export function parseTarArchive(gzipData){
 const raw=gunzipSync(gzipData,{maxOutputLength:MAX_TAR});
 for(let at=0;at+512<=raw.length;){
  const h=raw.subarray(at,at+512),name=h.subarray(0,100).toString('utf8').split('\0')[0];
  if(!name)break;
  const sizeStr=h.subarray(124,136).toString('ascii').replace(/\0/g,'').trim();
  const size=parseInt(sizeStr,8);
  if(!Number.isInteger(size)||size<0||size>MAX_TAR)throw Error('Entrada tar inválida');
  const start=at+512,end=start+size;
  if(end>raw.length)throw Error('Pacote tar incompleto');
  const clean=name.replace(/^(\.\/)+/,'');
  const kind=h.subarray(156,157).toString('ascii');
  if((clean==='assets/campaign.zip'||clean.endsWith('/assets/campaign.zip'))&&(kind==='0'||kind==='\0'||kind==='')){
   const data=raw.subarray(start,end);
   if(data.length<100||data.length>25*1024*1024||data.readUInt32LE(0)!==0x04034b50)throw Error('ZIP interno inválido');
   return data;
  }
  at=end+((512-(size%512))%512);
 }
 throw Error('Arquivo assets/campaign.zip não está no pacote privado');
}
export async function restorePrivateCampaign(){
 const signed=process.env.PROSPECTOR_MEDIA_RESTORE_URL;
 if(!signed)return {state:'NOT_CONFIGURED'};
 if(!getSetting('paused',true))return {state:'PAUSE_REQUIRED',message:'Operação precisa estar pausada antes de instalar campanha'};
 try{
  const u=new URL(signed);
  if(u.protocol!=='https:'||!/^([a-z0-9-]+\.)?oaiusercontent\.com$/.test(u.hostname)||!u.pathname.startsWith('/files/')||!u.pathname.endsWith('/raw'))throw Error('Origem não autorizada');
  const previous=getSetting('private_campaign_restore',null);
  if(previous?.state==='IMPORTED')return previous;
  const response=await fetch(u.toString(),{redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error('Falha ao obter arquivo privado HTTP '+response.status);
  if(Number(response.headers.get('content-length')||0)>MAX_TRANSFER)throw Error('Arquivo maior que 30 MB');
  let size=0;const chunks=[];
  for await(const chunk of response.body){
   size+=chunk.byteLength;
   if(size>MAX_TRANSFER)throw Error('Arquivo maior que 30 MB');
   chunks.push(Buffer.from(chunk));
  }
  const zip=parseTarArchive(Buffer.concat(chunks));
  const done=importCampaignPackage(zip);
  const value={state:'IMPORTED',workflowId:done.workflowId,audioId:done.audioId||null,videoId:done.videoId||null,alreadyInstalled:done.alreadyInstalled,paused:getSetting('paused',true),at:new Date().toISOString()};
  setSetting('private_campaign_restore',value);
  audit('PRIVATE_CAMPAIGN_RESTORED',null,{workflowId:done.workflowId,audio:!!done.audioId,video:!!done.videoId,alreadyInstalled:done.alreadyInstalled});
  return value;
 }catch(e){
  const value={state:'ERROR',message:String(e.message).slice(0,180),at:new Date().toISOString()};
  setSetting('private_campaign_restore',value);
  return value;
 }
}
export const privateRestoreStatus=()=>getSetting('private_campaign_restore',{state:'NOT_CONFIGURED'});
