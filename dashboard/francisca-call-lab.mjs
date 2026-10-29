// Experimental voice-turn engine. No WhatsApp call transport or public HTTP route is installed.
// Audio turn engine. Called by the authenticated WA-AKG bridge; no recordings.
// Exact owner JID and selected session are mandatory, including in owner QA sandbox.
// QA sandbox may speak, but cannot invoke owner tools.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {verifiedOwnerPhone,classifyContact} from './whatsapp-roles.mjs';
import {selectedWaSession} from './waakg-control.mjs';
import {transcribeAudio} from './waakg-audio-inbound.mjs';
import {makeFranciscaVoice,makeFranciscaCallPcm,checkVoiceText} from './francisca-tts.mjs';
import {groqChat} from './groq-models.mjs';
import {agentTools,runAgentTool} from './groq-owner-tools.mjs';

const execFile=promisify(execFileCb);
export const VOICE_RATE=16000;
const MAX_INPUT=VOICE_RATE*2*14,MIN_INPUT=VOICE_RATE*2/2;
const READ_ONLY=new Set(['system_status','system_diagnostics','list_prospects','search_leads','get_lead',
 'list_workflows','whatsapp_status','list_meetings','discovery_history','safe_settings',
 'read_outreach_queue','read_owner_settings']);
const allowedTools=agentTools.filter(x=>READ_ONLY.has(x.function.name));
export function callLabStatus(){
 return {enabled:process.env.WA_AKG_CALL_LAB_ENABLED==='true',provider:'WA-AKG/experimental',
  mediaTransportConnected:false,answeringCalls:false,mode:'half-duplex prototype',
  ownerOnly:true,readOnly:true,pcmHz:VOICE_RATE};
}
export function wavFromPcm16(pcm){
 if(!Buffer.isBuffer(pcm)||pcm.length%2!==0||pcm.length<MIN_INPUT||pcm.length>MAX_INPUT)
  throw Error('PCM16_16KHZ_INVALID_DURATION');
 const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);
 header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);
 header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(VOICE_RATE,24);
 header.writeUInt32LE(VOICE_RATE*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
 header.write('data',36);header.writeUInt32LE(pcm.length,40);
 return Buffer.concat([header,pcm]);
}
export function verifyVoiceOwner({jid,sessionId}={}){
 if(process.env.WA_AKG_CALL_LAB_ENABLED!=='true')throw Error('VOICE_CALL_LAB_DISABLED');
 const expected=verifiedOwnerPhone();
 if(!expected||jid!==expected+'@s.whatsapp.net'||sessionId!==selectedWaSession())
  throw Error('VOICE_CALL_UNVERIFIED_OWNER');
 const role=classifyContact({jid,sessionId});
 if(role.role!=='OWNER'||role.authorized!==true)
  throw Error('VOICE_CALL_UNVERIFIED_OWNER');
 // Sandbox disables privileged owner tools; it must not silence the owner's voice.
 return {jid,sessionId,ownerTools:role.ownerTools===true};
}
export async function convertM4aToPcm16(bytes,{exec=execFile}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<256||bytes.length>5*1024*1024)
  throw Error('VOICE_OUTPUT_INVALID');
 const dir=await mkdtemp(path.join(tmpdir(),'francisca-call-'));
 try{
  const inFile=path.join(dir,'reply.m4a'),outFile=path.join(dir,'reply.pcm');
  await writeFile(inFile,bytes);
  await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',inFile,'-ac','1',
   '-ar',String(VOICE_RATE),'-f','s16le','-acodec','pcm_s16le',outFile],{timeout:15000,maxBuffer:50000});
  const output=await readFile(outFile);
  if(!output.length||output.length>VOICE_RATE*2*60)throw Error('PCM_OUTPUT_SIZE');
  return output;
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
export function newFranciscaCallSession({jid,sessionId}={},deps={}){
 // Always validate at creation AND each turn; no unverified caller can use AI tools.
 verifyVoiceOwner({jid,sessionId});
 const history=[];
 let busy=false,ended=false;
 return {
  async reply(pcm16k){
   if(ended)throw Error('CALL_ENDED');
   if(busy)throw Error('CALL_BUSY');
   verifyVoiceOwner({jid,sessionId});
   const wav=wavFromPcm16(pcm16k);
   busy=true;
   try{
    const began=Date.now();
    const recognized=await (deps.transcribe||transcribeAudio)({buffer:wav,filename:'live-turn.wav'});
    const sttMs=Date.now()-began;
    const heard=String(recognized.text||'').trim().slice(0,650);
    if(heard.length<2)throw Error('CALL_TRANSCRIPTION_EMPTY');
    const verified=verifyVoiceOwner({jid,sessionId});
    const availableTools=verified.ownerTools?allowedTools:[];
    const messages=[
     {role:'system',content:'Você é a Francisca, atendente virtual da Consecom, numa ligação com o proprietário. Converse em português brasileiro, de forma humana, espontânea e direta. Responda em uma ou duas frases curtas, sem listas, textos longos nem repetir a pergunta. Nunca alegue ser humana. Só utilize ferramentas de leitura do Prospector. NUNCA envie mensagens, ative campanhas, gaste dinheiro, altere configurações ou execute ordens por voz; explique que essas ações requerem confirmação por texto. Não invente informações sobre o sistema.'},
     ...history,{role:'user',content:heard}
    ];
    const chat=deps.chat||groqChat,readTool=deps.readTool||runAgentTool;
    let result=await chat({task:'voice',messages,tools:availableTools,maxTokens:170});
    for(let n=0;n<2&&result.choice?.tool_calls?.length;n++){
     const calls=result.choice.tool_calls.slice(0,2);
     messages.push(result.choice);
     for(const call of calls){
      let output;
      try{
       if(!availableTools.some(x=>x.function.name===call.function?.name))throw Error('READ_ONLY_CALL');
       output=await readTool(call.function.name,JSON.parse(call.function.arguments||'{}'),{jid,sessionId});
      }catch(e){output={error:String(e.message).slice(0,90)};}
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output).slice(0,3000)});
     }
     result=await chat({task:'voice',messages,tools:availableTools,maxTokens:170});
    }
    const llmMs=Date.now()-began-sttMs;
    let spoken=String(result.choice?.content||'').trim().slice(0,300);
    if(spoken.length<2)spoken='Não consegui entender. Pode repetir, por favor?';
    spoken=checkVoiceText(spoken);
    // Test fixtures may inject the legacy two-step converter. Production
    // performs one MP3->PCM conversion without the intermediate AAC/M4A.
    const pcmGenerator=deps.synthesizePcm||(!deps.synthesize&&!deps.convert?makeFranciscaCallPcm:null);
    let outgoing,voice;
    if(pcmGenerator){const data=await pcmGenerator(spoken);outgoing=data.pcm16k;voice=data.voice;}
    else {const audio=await (deps.synthesize||makeFranciscaVoice)(spoken);
      outgoing=await (deps.convert||convertM4aToPcm16)(audio.bytes);voice=audio.voice;}
    if(!Buffer.isBuffer(outgoing)||outgoing.length===0||outgoing.length%2)
     throw Error('CALL_AUDIO_OUT_INVALID');
    const ttsMs=Date.now()-began-sttMs-llmMs;
    console.info('[francisca-call-turn-timing]',JSON.stringify({sttMs,llmMs,ttsMs,totalMs:Date.now()-began,
      inputMs:Math.round(pcm16k.length/32),outputMs:Math.round(outgoing.length/32)}));
    history.push({role:'user',content:heard},{role:'assistant',content:spoken});
    if(history.length>8)history.splice(0,history.length-8);
    return {heard,spoken,pcm16k:outgoing,format:'s16le',rate:VOICE_RATE,voice};
   }finally{busy=false;}
  },
  end(){ended=true;history.length=0;},
  get state(){return ended?'ENDED':busy?'BUSY':'READY';}
 };
}
