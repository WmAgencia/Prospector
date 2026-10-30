// Experimental WhatsApp native calls for the existing WA-AKG Baileys socket.
// No second socket, credentials store, or outgoing calls. Owner-only inbound calls.
// Compatible with the pinned community voice-protocol (typechecked in CI).
import {jidDecode, jidEncode, type BinaryNode} from "@whiskeysockets/baileys";
import {NativeCallManager,createCallAck} from "./voice-protocol/src/index.js";
import {TurnDetector,PlaybackGate} from "./turn-taking.mjs";
import {InterruptionLedger,BackchannelPolicy,ThinkingCuePolicy} from "./conversation-runtime.mjs";
import type {WASocket} from "@whiskeysockets/baileys";

const SAMPLE_RATE=16000;
const BRIDGE_URL=(process.env.PROSPECTOR_VOICE_BASE_URL||"").replace(/\/+$/,"")+"/api/internal/waakg/call-turn";
const SECRET=process.env.WA_CALL_BRIDGE_SECRET||"";
const owner=String(process.env.PROSPECTOR_OWNER_PHONE||"").replace(/\D/g,"");
const correctSession=process.env.WA_AKG_SESSION_ID||"";
const quiet=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
type Session={
 callId:string;from:string;startedAt:number;ended:boolean;greeted:boolean;
 replying:boolean;playback:boolean;pending:Buffer|null;
 detector:TurnDetector;gate:PlaybackGate;
 ledger:InterruptionLedger;backchannel:BackchannelPolicy;thinking:ThinkingCuePolicy;
 ackBusy:boolean;cuePlaying:boolean;cueDirty:boolean;
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
async function bridge(call:Session,sessionId:string,event:"greeting"|"turn"|"end"|"backchannel",
 pcm?:Buffer,metadata?:Record<string,unknown>){
 const data={callId:call.callId,jid:owner+"@s.whatsapp.net",sessionId,event,
  ...(pcm?{pcm16k:pcm.toString("base64")}:{}) ,...(metadata||{})};
 const res=await fetch(BRIDGE_URL,{method:"POST",headers:{"content-type":"application/json",
  "x-wa-call-bridge-secret":SECRET},body:JSON.stringify(data),signal:AbortSignal.timeout(80_000)});
 if(!res.ok)throw Error("PROSPECTOR_BRIDGE_"+res.status);
 const answer=await res.json() as {ok:boolean,pcm16k?:string,replyId?:string};
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
async function renderReply(manager:NativeCallManager,call:Session,audio64:string,generation:number){
 if(!audio64||audio64.length>16000*2*65*1.4)throw Error("VOICE_REPLY_TOO_LARGE");
 const pcm=Buffer.from(audio64,"base64");
 if(!pcm.length||pcm.length%2)throw Error("VOICE_REPLY_INVALID");
 call.playback=true;
 try{
  for(let offset=0;offset<pcm.length&&!call.ended&&call.gate.valid(generation);offset+=640){
   const buf=pcm.subarray(offset,Math.min(pcm.length,offset+640));
   const frame=new Float32Array(buf.length/2);
   for(let i=0;i<frame.length;i++)frame[i]=buf.readInt16LE(i*2)/32768;
   // The AudioEngine's external-mode circular playback queue is reset on barge-in.
   if(!call.gate.valid(generation))break;
   manager.feedLiveAudio(frame);
   call.ledger.progress((offset+buf.length)/32);
   await quiet(20);
  }
 }finally{
  call.playback=false;
 }
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
  if(call){call.ended=true;call.pending=null;call.gate.cancel();call.detector.reset();call.ledger.clear();call.cuePlaying=false;}
  call=null;
 };
 async function sendTurn(active:Session,event:"turn"|"greeting",pcm?:Buffer){
  if(active.replying||active.ended)return;
  active.replying=true;
  const generation=active.gate.next();
  const started=Date.now();
  const thinkingId=active.thinking.start(started);
  // A rare acknowledgment only if processing actually stalls; never overlap an immediate reply.
  const thinkingTimer=event==="turn"?setTimeout(()=>void maybeThink(active,generation,thinkingId),active.thinking.delayMs+30):null;
  thinkingTimer?.unref?.();
  const interruption=event==="turn"?active.ledger.take():null;
  try{
   const r=await bridge(active,sessionId,event,pcm,interruption?{interruption}:undefined);
   if(active.ended||!same(active.callId)||!r.pcm16k)return;
   const durationMs=Math.min(60000,Math.round(Buffer.from(r.pcm16k,"base64").length/32));
   if(!active.gate.valid(generation)){
    // A follow-up arrived while Groq/TTS was still thinking. That discarded
    // answer is still available to the next turn as an unfinished draft.
    if(r.replyId)active.ledger.unseen(r.replyId,durationMs);
    return;
   }
   if(r.replyId)active.ledger.begin(r.replyId,durationMs);
   // If a short thinking/acknowledgment cue is still in the outgoing jitter buffer,
   // flush only that buffer before the real response to avoid overlay or extra latency.
   if(active.cueDirty){active.cuePlaying=false;active.cueDirty=false;manager.setExternalAudioMode(true);}
   console.info("[voice-calls] BRIDGE_RESPONSE_READY",event,"ms",Date.now()-started);
   await renderReply(manager,active,r.pcm16k,generation);
   if(active.gate.valid(generation)){
    active.ledger.completed();
    console.info("[voice-calls] FRANCISCA_AUDIO_SENT",event);
   }
  }catch(e){
   if(!active.ended)console.warn("[voice-calls] TURN_ERROR",String((e as Error).message).slice(0,75));
  }finally{
   if(thinkingTimer)clearTimeout(thinkingTimer);
   active.cuePlaying=false;
   active.playback=false;
   active.replying=false;
   if(!active.ended&&same(active.callId)&&active.pending){
    const next=active.pending;active.pending=null;
    queueMicrotask(()=>void sendTurn(active,"turn",next));
   }
  }
 }
 // A short empathetic cue after a perceptible processing delay, never for
 // immediate responses. Nonverbal audio alone does not consume a user turn.
 async function maybeThink(active:Session,generation:number,thinkingId:number){
  if(!same(active.callId)||!active.gate.valid(generation))return;
  if(!active.thinking.due({turnId:thinkingId,replying:active.replying,
   playing:active.playback||active.cuePlaying,ackBusy:active.ackBusy,ended:active.ended,
   userSpeaking:active.detector.hasSpeech}))return;
  const kind=active.thinking.claim();
  if(!kind)return;
  try{
   const r=await bridge(active,sessionId,"backchannel",undefined,{kind});
   if(!r.pcm16k||active.ended||!active.replying||active.playback||!active.gate.valid(generation))return;
   const pcm=Buffer.from(r.pcm16k,"base64");
   if(pcm.length<2000||pcm.length>16000*2*3||pcm.length%2)return;
   active.cuePlaying=true;
   for(let offset=0;offset<pcm.length&&!active.ended&&active.replying&&active.gate.valid(generation);offset+=320){
    if(active.playback||!active.cuePlaying)break;
    const buf=pcm.subarray(offset,Math.min(offset+320,pcm.length));
    const frame=new Float32Array(buf.length/2);
    for(let i=0;i<frame.length;i++)frame[i]=buf.readInt16LE(i*2)/32768*.28;
    active.cueDirty=true;
    manager.feedLiveAudio(frame);
    await quiet(10);
   }
   if(active.gate.valid(generation))console.info("[voice-calls] THINKING_ACK_SENT",kind);
  }catch(e){
   console.warn("[voice-calls] THINKING_ACK_FAILED",String((e as Error).message).slice(0,70));
  }finally{
   active.cuePlaying=false;
  }
 }
 async function acknowledge(active:Session,kind:"aham"|"hum"){
  if(active.ackBusy||active.ended)return;
  active.ackBusy=true;
  try{
   const r=await bridge(active,sessionId,"backchannel",undefined,{kind});
   if(!r.pcm16k||active.ended||active.replying||active.playback||!active.detector.hasSpeech)return;
   const pcm=Buffer.from(r.pcm16k,"base64");
   if(pcm.length<2000||pcm.length>16000*2*2||pcm.length%2)return;
   for(let offset=0;offset<pcm.length&&!active.ended;offset+=320){
    if(active.replying||active.playback||!active.detector.hasSpeech)break;
    const chunk=pcm.subarray(offset,Math.min(pcm.length,offset+320));
    const frame=new Float32Array(chunk.length/2);
    // Quiet acknowledgement: background confirmation, not a second speaker turn.
    for(let i=0;i<frame.length;i++)frame[i]=chunk.readInt16LE(i*2)/32768*.23;
    active.cueDirty=true;
    manager.feedLiveAudio(frame);
    await quiet(10);
   }
   console.info("[voice-calls] LISTENING_ACK_SENT",kind);
  }catch(e){
   console.warn("[voice-calls] LISTENING_ACK_FAILED",String((e as Error).message).slice(0,70));
  }finally{active.ackBusy=false;}
 }

 manager.on("call:incoming",async(c:any)=>{
  // The call event is always reauthenticated against exact PN, not display name.
  let pn:string|null=null;
  try{pn=await exactCaller(sock,c.peerJid);}catch{}
  if(!pn){console.info("[voice-calls] CALLER_NOT_OWNER");return;}
  if(call&&!call.ended){console.info("[voice-calls] BUSY");return;}
  if(c.isVideo||c.mediaType==="video"){console.info("[voice-calls] VIDEO_NOT_SUPPORTED");return;}
  const incoming:Session={callId:c.callId,from:pn,startedAt:Date.now(),ended:false,greeted:false,
   replying:false,playback:false,pending:null,detector:new TurnDetector({stopSilenceMs:660,bargeVoiceMs:320,maxTurnMs:13000}),gate:new PlaybackGate(),
   ledger:new InterruptionLedger(),backchannel:new BackchannelPolicy(),
   thinking:new ThinkingCuePolicy(),ackBusy:false,cuePlaying:false,cueDirty:false};
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
  if(!active||active.ended||!audio.length)return;
  const mode=(active.playback||active.cuePlaying)?"speaking":active.replying?"thinking":"listening";
  const result=active.detector.push(audio,mode);
  if(result.type==="interrupt"){
   active.ledger.interrupt();
   active.gate.cancel(); // Only sound stops; previous question and answer draft are retained.
   active.playback=false;active.cuePlaying=false;active.cueDirty=false;
   // Flush unread TTS samples from the same already-authenticated WA-AKG socket.
   manager.setExternalAudioMode(true);
   console.info("[voice-calls] FRANCISCA_INTERRUPTED");
  }else if(result.type==="turn"){
   const pcm=encodePcm(result.frames);
   active.backchannel.resetTurn();
   console.info("[voice-calls] USER_TURN_DETECTED",result.durationMs,result.voiceMs);
   if(active.replying){
    // Preserve multiple additions spoken during one in-flight AI response.
    // Append a brief silence between user utterances for clean transcription.
    const separator=Buffer.alloc(16000*2/5); // 200 ms, mono PCM16
    const combined=active.pending?Buffer.concat([active.pending,separator,pcm]):pcm;
    active.pending=combined.length<=16000*2*13?combined:combined.subarray(combined.length-16000*2*13);
    active.gate.cancel();
   }else void sendTurn(active,"turn",pcm);
  }else if(result.type==="none"&&mode==="listening"&&!active.ackBusy&&
   active.backchannel.canPlay({voicedSamples:active.detector.voiced,replying:active.replying,
    playing:active.playback,ended:active.ended})){
   const kind=active.backchannel.played();
   void acknowledge(active,kind);
  }
 });

 ws.on("CB:call",async(node:BinaryNode)=>{
  const inner=Array.isArray(node.content)?node.content[0] as BinaryNode:null;
  if(!inner?.tag)return;
  try{
   const peer=String(node.attrs.from||"");
   if(node.attrs.id&&peer)await (sock as any).sendNode(createCallAck(String(node.attrs.id),peer,inner.tag));
   const decoded=jidDecode(peer),njid=decoded?jidEncode(decoded.user,decoded.server,decoded.device):peer;
   switch(inner.tag){
    case "offer":if(await exactCaller(sock,njid))await manager.handleCallOffer(node,njid);else console.info("[voice-calls] NON_OWNER_OFFER_IGNORED");break;
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
