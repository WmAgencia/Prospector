// Experimental WhatsApp native calls for the existing WA-AKG Baileys socket.
// No second socket, credentials store, or outgoing calls. Owner-only inbound calls.
// Compatible with the pinned community voice-protocol (typechecked in CI).
import {jidDecode, jidEncode, type BinaryNode} from "@whiskeysockets/baileys";
import {NativeCallManager,createCallAck} from "../../voice-protocol/src/index.js";
import type {WASocket} from "@whiskeysockets/baileys";

const SAMPLE_RATE=16000;
const TURN_MAX=12*SAMPLE_RATE;
const TALK_RMS=0.017;
const BRIDGE_URL=(process.env.PROSPECTOR_VOICE_BASE_URL||"").replace(/\/+$/,"")+"/api/internal/waakg/call-turn";
const SECRET=process.env.WA_CALL_BRIDGE_SECRET||"";
const owner=String(process.env.PROSPECTOR_OWNER_PHONE||"").replace(/\D/g,"");
const correctSession=process.env.WA_AKG_SESSION_ID||"";
const quiet=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
type Session={
 callId:string;from:string;startedAt:number;ended:boolean;greeted:boolean;
 replying:boolean;playback:boolean;quietFrames:number;voiceFrames:number;frames:Float32Array[];
 cooldownUntil:number;
};
function requireReady(sessionId:string){
 return !!owner&&/^55\d{10,11}$/.test(owner)&&sessionId===correctSession&&
  SECRET.length>=40&&/^https:\/\//.test(BRIDGE_URL);
}
function cleanJid(x:string){
 const p=jidDecode(x);return p?jidEncode(p.user,p.server,p.device):x;
}
async function exactCaller(sock:WASocket,peer:string){
 const source=cleanJid(peer);
 const parsed=jidDecode(source);
 if(!parsed)return null;
 let pn=source;
 if(parsed.server==="lid"){
  const map=(sock as any).signalRepository?.lidMapping;
  pn=await map?.getPNForLID?.(source)||await map?.getPNForLID?.(jidEncode(parsed.user,"lid"))||"";
 }
 const out=jidDecode(pn);
 return out?.server==="s.whatsapp.net"&&out.user===owner?pn:null;
}
async function bridge(call:Session,sessionId:string,event:"greeting"|"turn"|"end",pcm?:Buffer){
 const data={callId:call.callId,jid:owner+"@s.whatsapp.net",sessionId,event,...(pcm?{pcm16k:pcm.toString("base64")}:{})};
 const res=await fetch(BRIDGE_URL,{method:"POST",headers:{"content-type":"application/json",
  "x-wa-call-bridge-secret":SECRET},body:JSON.stringify(data),signal:AbortSignal.timeout(80_000)});
 if(!res.ok)throw Error("PROSPECTOR_BRIDGE_"+res.status);
 const answer=await res.json() as {ok:boolean,pcm16k?:string};
 if(!answer.ok)throw Error("BRIDGE_NOT_OK");
 return answer;
}
function encodePcm(frames:Float32Array[]):Buffer{
 const length=frames.reduce((x,f)=>x+f.length,0);
 const out=Buffer.alloc(length*2);let offset=0;
 for(const frame of frames)for(let i=0;i<frame.length;i++){
  const s=Math.max(-1,Math.min(1,frame[i]||0));
  out.writeInt16LE(Math.round(s*32767),offset);
  offset+=2;
 }
 return out;
}
async function renderReply(manager:NativeCallManager,call:Session,audio64:string){
 if(!audio64||audio64.length>16000*2*65*1.4)throw Error("VOICE_REPLY_TOO_LARGE");
 const pcm=Buffer.from(audio64,"base64");
 if(!pcm.length||pcm.length%2)throw Error("VOICE_REPLY_INVALID");
 call.playback=true;
 try{
  for(let offset=0;offset<pcm.length&&!call.ended;offset+=640){
   const buf=pcm.subarray(offset,Math.min(pcm.length,offset+640));
   const frame=new Float32Array(buf.length/2);
   for(let i=0;i<frame.length;i++)frame[i]=buf.readInt16LE(i*2)/32768;
   manager.feedLiveAudio(frame);
   await quiet(20);
  }
 }finally{call.playback=false;call.cooldownUntil=Date.now()+950;}
}
export function installFranciscaCalls(sock:WASocket,sessionId:string){
 if(process.env.WA_AKG_CALLS_ENABLED!=="true")return;
 if(!requireReady(sessionId)){console.warn("[voice-calls] DISABLED_MISSING_CONFIG");return;}
 const manager=new NativeCallManager({sock,debug:false});
 const ws=(sock as any).ws;
 if(!ws?.on){console.warn("[voice-calls] WA_SOCKET_NOT_READY");manager.destroy();return;}
 let call:Session|null=null;
 function same(id:string){return call&&!call.ended&&call.callId===id?call:null;}
 const reset=()=>{
  if(call)call.ended=true;
  call=null;
 };
 async function sendTurn(active:Session,event:"turn"|"greeting",pcm?:Buffer){
  if(active.replying||active.ended)return;
  active.replying=true;
  active.frames=[];active.voiceFrames=0;active.quietFrames=0;
  try{
   const r=await bridge(active,sessionId,event,pcm);
   if(active.ended||!same(active.callId)||!r.pcm16k)return;
   await renderReply(manager,active,r.pcm16k);
   console.info("[voice-calls] FRANCISCA_AUDIO_SENT",event);
  }catch(e){
   console.warn("[voice-calls] TURN_ERROR",String((e as Error).message).slice(0,75));
  }finally{active.replying=false;}
 }
 manager.on("call:incoming",async(c:any)=>{
  // The call event is always reauthenticated against exact PN, not display name.
  let pn:string|null=null;
  try{pn=await exactCaller(sock,c.peerJid);}catch{}
  if(!pn){console.info("[voice-calls] CALLER_NOT_OWNER");return;}
  if(call&&!call.ended){console.info("[voice-calls] BUSY");return;}
  if(c.isVideo||c.mediaType==="video"){console.info("[voice-calls] VIDEO_NOT_SUPPORTED");return;}
  const incoming:Session={callId:c.callId,from:pn,startedAt:Date.now(),ended:false,greeted:false,
   replying:false,playback:false,quietFrames:0,voiceFrames:0,frames:[],cooldownUntil:0};
  call=incoming;
  try{
   manager.setExternalAudioMode(true);
   await manager.acceptCall(incoming.callId);
   console.info("[voice-calls] OWNER_CALL_ACCEPTED");
  }catch(e){
   console.warn("[voice-calls] ACCEPT_FAILED",String((e as Error).message).slice(0,100));
   reset();
  }
 });
 manager.on("call:state",(c:any)=>{
  const active=same(c.callId);
  if(active&&!active.greeted&&String(c.stateData?.state).toLowerCase()==="active"){
   active.greeted=true;
   void sendTurn(active,"greeting");
  }
 });
 manager.on("call:ended",(c:any)=>{
  const active=same(c.callId);
  if(active){void bridge(active,sessionId,"end").catch(()=>{});reset();}
  console.info("[voice-calls] CALL_ENDED");
 });
 manager.on("call:error",(e:Error)=>console.warn("[voice-calls] MEDIA_ERROR",String(e.message).slice(0,100)));
 manager.on("call:audio",(audio:Float32Array)=>{
  const active=call;
  if(!active||active.ended||active.replying||active.playback||Date.now()<active.cooldownUntil)return;
  if(!audio.length)return;
  const segment=new Float32Array(audio);let sum=0;
  for(let i=0;i<segment.length;i++)sum+=segment[i]*segment[i];
  const rms=Math.sqrt(sum/segment.length),voice=rms>TALK_RMS;
  active.frames.push(segment);
  if(voice){active.voiceFrames+=segment.length;active.quietFrames=0;}
  else active.quietFrames+=segment.length;
  const samples=active.frames.reduce((n,x)=>n+x.length,0);
  // Keep 250ms pre-roll but ignore long silence before the user begins speaking.
  if(active.voiceFrames===0&&samples>SAMPLE_RATE/4)active.frames.splice(0,active.frames.length-4);
  else if(active.voiceFrames>=SAMPLE_RATE*.35&&(active.quietFrames>=SAMPLE_RATE*.75||samples>=TURN_MAX)){
   const payload=encodePcm(active.frames);
   void sendTurn(active,"turn",payload);
  }
  // Hard cap even if no silence; never persist incoming voice.
  if(samples>TURN_MAX)active.frames=[];
 });
 ws.on("CB:call",async(node:BinaryNode)=>{
  const inner=Array.isArray(node.content)?node.content[0] as BinaryNode:null;
  if(!inner?.tag)return;
  try{
   const peer=String(node.attrs.from||"");
   if(node.attrs.id&&peer)await (sock as any).sendNode(createCallAck(String(node.attrs.id),peer,inner.tag));
   const decoded=jidDecode(peer),njid=decoded?jidEncode(decoded.user,decoded.server,decoded.device):peer;
   switch(inner.tag){
    case "offer":await manager.handleCallOffer(node,njid);break;
    case "preaccept":await manager.handleCallPreaccept(node,njid);break;
    case "accept":await manager.handleCallAccept(node,njid);break;
    case "transport":await manager.handleCallTransport(node,njid);break;
    case "terminate":manager.handleCallTerminate(node);break;
    case "relaylatency":await manager.handleCallRelaylatency(node,njid);break;
    case "mute_v2":await manager.handleCallMuteV2(node,njid);break;
    case "relay_election":manager.handleRelayElection(node);break;
   }
  }catch(e){console.warn("[voice-calls] SIGNAL_ERROR",String((e as Error).message).slice(0,110));}
 });
 ws.on("CB:ack,class:call",async(node:BinaryNode)=>{try{await manager.handleCallAck(node);}catch{}});
 ws.on("CB:receipt",async(node:BinaryNode)=>{
  const inner=Array.isArray(node.content)?node.content[0] as BinaryNode:null;
  if(!inner||!["offer","accept","preaccept","terminate","transport"].includes(inner.tag))return;
  try{await (sock as any).sendNode({tag:"ack",attrs:{id:String(node.attrs.id),to:String(node.attrs.from),class:"receipt",type:String(node.attrs.type||"retry")}});}catch{}
 });
 console.info("[voice-calls] OWNER_CALL_LISTENER_READY",sessionId);
}
