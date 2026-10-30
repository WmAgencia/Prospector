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
import {selectedWaSession,waRequest} from './waakg-control.mjs';
import {OWNER_PERSONA} from './francisca-owner-persona.mjs';
import {voiceToolsForOwner,runOwnerVoiceTool} from './francisca-owner-voice-actions.mjs';
import {transcribeAudio} from './waakg-audio-inbound.mjs';
import {makeFranciscaVoice,makeFranciscaCallPcm,checkVoiceText} from './francisca-tts.mjs';
import {groqChat} from './groq-models.mjs';
import {agentTools,runAgentTool,readVoiceOperationalBriefing} from './groq-owner-tools.mjs';
import {newCallContext} from './francisca-voice-context.mjs';
import {voiceReplyPlan,voiceStyleInstruction,polishVoiceReply} from './francisca-dialogue-style.mjs';
import {randomUUID} from 'node:crypto';

const execFile=promisify(execFileCb);
// Keep a few high-confidence operational counts available even if the model
// or Groq function calling is temporarily unavailable. Never guess DB values.
const asksApproachedCount=x=>{
 const t=String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return /(?:quantos|quantas|numero|total|quantidade|qtd|me diz|me fala|sabe quantos)/.test(t)&&
  /(?:abord\w*|contat\w*|contactad\w*|primeiro contato|mensagens enviadas|prospectos abordados)/.test(t);
};
function selectVoiceTools(tools,spoken){
 const norm=String(spoken||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let wants;
 if(/(?:envi\w*|manda\w*|mande\w*|mensag\w*|whatsapp|numero|telefone|recado)/.test(norm))
  wants=['prepare_direct_message','prepare_message','search_leads','list_whatsapp_chats','read_whatsapp_chat'];
 else if(/(?:lead|abord|prospect|contat|empresa|cliente)/.test(norm))
  wants=['system_status','list_prospects','search_leads','get_lead','list_conversations','read_conversation'];
 else if(/(?:campanha|fila|abordagem|automacao|paus|retomar)/.test(norm))
  wants=['system_status','read_outreach_queue','list_workflows','request_start_outreach','cancel_outreach','request_select_workflow','request_change_setting'];
 else if(/(?:reuniao|agenda|encontro)/.test(norm))
  wants=['list_meetings','create_meeting','request_cancel_meeting','search_leads'];
 else if(/(?:relatorio|diagnost|sistema|status|situacao)/.test(norm))
  wants=['system_status','system_diagnostics','read_outreach_queue','read_owner_settings','discovery_history'];
 else wants=['system_status','list_capabilities','search_leads','list_conversations','prepare_direct_message'];
 const allowed=new Set(wants);
 return tools.filter(t=>allowed.has(t.function.name));
}
export const VOICE_RATE=16000;
const MAX_INPUT=VOICE_RATE*2*14,MIN_INPUT=VOICE_RATE*2/2;
// Read tools run during the call. Write tools only prepare an approval code;
 // the actual change requires a separate message from the owner's verified JID.
async function notifyOwnerApproval({jid,sessionId,name,code,preview}){
 const summary=typeof preview==='string'?preview:JSON.stringify(preview||{});
 const text='Francisca — pedido iniciado por ligação\nAção: '+String(name||'').slice(0,60)+
  '\nPrévia: '+summary.slice(0,800)+'\nAinda NÃO executado. Para autorizar, responda: CONFIRMAR '+code+
  '\nPrazo: 10 minutos. Se não reconhecer o pedido, ignore.';
 try{
  const ack=await waRequest('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send',
   {method:'POST',data:{message:{text}}});
  return ack.status===true;
 }catch{return false;}
}
export function callLabStatus(){
 return {enabled:process.env.WA_AKG_CALL_LAB_ENABLED==='true',provider:'WA-AKG/experimental',
  mediaTransportConnected:false,answeringCalls:false,mode:'half-duplex prototype',
  ownerOnly:true,readOnly:false,requiresWhatsAppTextConfirmation:true,pcmHz:VOICE_RATE};
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
 const context=newCallContext();
 let busy=false,ended=false;
 return {
  async reply(pcm16k,{interruption}={}){
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
    const availableTools=selectVoiceTools(voiceToolsForOwner(agentTools,verified.ownerTools),heard);
    console.info('[francisca-voice-owner-access]',JSON.stringify({
     ownerVerified:verified.ownerTools===true,toolsAvailable:availableTools.length,
     callMode:'OWNER',stagedActionsOnly:true
    }));
    if(interruption)context.noteInterruption(interruption);
    // Voice sandbox blocks commands, but a verified owner may inspect safe,
    // aggregate operational facts. Preload these before calling Groq so a
    // malformed model tool call cannot make the reply completely ungrounded.
    let operationalBriefing=null;
    if(asksApproachedCount(heard)||/prospector|(?:situação|status|diagnóstico|pendências|falta implementar|verificar.*sistema|como está o sistema)/i.test(heard)){
     try{
      operationalBriefing=await (deps.readOperationalBriefing||readVoiceOperationalBriefing)({jid,sessionId});
      console.info('[francisca-voice-briefing]',JSON.stringify({
       ok:true,hasStats:!!operationalBriefing?.stats,source:'operational-db'
      }));
     }catch(e){
      console.warn('[francisca-voice-briefing]',JSON.stringify({
       ok:false,error:String(e?.message||e).slice(0,55)
      }));
     }
    }
    const spokenHistory=context.messages();
    const replyPlan=voiceReplyPlan(heard,spokenHistory);
    // Verified owner requests about approach totals are grounded directly
    // by SQLite and do not depend on Groq picking the correct tool.
    const directCount=asksApproachedCount(heard)&&operationalBriefing?.stats&&
     Number.isInteger(operationalBriefing.stats.approached)?
      'Até este momento, o Prospector registra '+operationalBriefing.stats.approached+
      ' leads abordados, de '+operationalBriefing.stats.leads+' cadastrados. Esse total considera abordagens confirmadas, não mensagens apenas preparadas.':null;
    const messages=[
     {role:'system',content:voiceStyleInstruction({heard,history:spokenHistory})},
     {role:'system',content:OWNER_PERSONA+'\nLIGAÇÃO DO PROPRIETÁRIO: você pode consultar dados reais e PREPARAR tarefas. Para qualquer envio ou mudança, apresente código de confirmação por TEXTO. Não há acesso irrestrito ao servidor ou segredos.'},
     {role:'system',content:context.systemNote(heard)},
     ...(operationalBriefing?[{role:'system',content:
      'DADOS OPERACIONAIS REAIS DISPONÍVEIS AGORA (somente leitura): '+
      JSON.stringify(operationalBriefing).slice(0,2600)+
      '\nAo responder, cite apenas o que esses dados demonstram. Nunca confunda situação operacional com lista completa do que falta implementar. Se a pergunta for sobre pendências técnicas não verificadas pelo repositório, diga que uma auditoria de código é necessária.'}]:[]),
     ...spokenHistory,{role:'user',content:heard}
    ];
    const chat=deps.chat||groqChat,readTool=deps.readTool||runAgentTool;
    let spoken='';
    try{
     let result=directCount?{choice:{content:directCount}}:
      await chat({task:availableTools.length?'actions':'voice',messages,tools:availableTools,maxTokens:Math.max(550,replyPlan.maxTokens)});
     for(let n=0;n<2&&result.choice?.tool_calls?.length;n++){
      const calls=result.choice.tool_calls;
      messages.push(result.choice);
      // Every tool_call_id needs a tool response, including skipped calls:
      // otherwise the next API request is invalid (often HTTP 400).
      for(let i=0;i<calls.length;i++){
       const call=calls[i];
       let output;
       try{
        if(i>=2)throw Error('CALL_TOOL_LIMIT');
        if(!availableTools.some(x=>x.function.name===call.function?.name))throw Error('VOICE_TOOL_NOT_AVAILABLE');
        const command=await runOwnerVoiceTool(call.function.name,JSON.parse(call.function.arguments||'{}'),
         {jid,sessionId},readTool);
        output=command;
        if(command?.requiresConfirmation&&command.code){
         const notify=deps.notifyOwnerApproval||notifyOwnerApproval;
         const delivered=await notify({jid,sessionId,name:call.function.name,code:command.code,
          preview:command.result?.preview||command.preview});
         output={...command,confirmationWhatsAppDelivered:delivered===true,
          nextStep:'Proprietário precisa enviar CONFIRMAR '+command.code+' pelo WhatsApp para efetivar'};
        }
       }catch(e){output={error:String(e.message).slice(0,90)};}
       messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output).slice(0,3000)});
      }
      result=await chat({task:availableTools.length?'actions':'voice',messages,tools:availableTools,maxTokens:Math.max(550,replyPlan.maxTokens)});
     }
     spoken=polishVoiceReply(result.choice?.content||'',{history:spokenHistory,heard,maxChars:replyPlan.maxChars});
     if(spoken.length<2)throw Error('VOICE_LLM_EMPTY');
    }catch(e){
     // The caller must NEVER get prolonged silence when a provider rejects
     // a request. No system state is invented and no actions are attempted.
     console.warn('[francisca-call-recovery]',JSON.stringify({reason:String(e?.message||e).slice(0,55)}));
     const wantsStatus=/prospector|sistema|campanha|pend[eê]ncia|implementar|relat[oó]rio|diagn[oó]stico|lead|abordado/i.test(heard);
     spoken=asksApproachedCount(heard)&&operationalBriefing?.stats&&Number.isInteger(operationalBriefing.stats.approached)
      ? 'O sistema confirma '+operationalBriefing.stats.approached+' leads abordados, de '+operationalBriefing.stats.leads+' cadastrados.'
      :wantsStatus
      ?'Recebi sua pergunta, mas a consulta ao sistema não terminou corretamente. Não vou inventar os números nem afirmar que fiz alguma ação.'
      :'Recebi o que você disse, mas o serviço de respostas está instável neste momento. Nenhuma ação foi executada.';
    }
    const llmMs=Date.now()-began-sttMs;
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
    const replyId=randomUUID();
    context.remember({heard,spoken,replyId,totalMs:Math.round(outgoing.length/32)});
    return {heard,spoken,replyId,pcm16k:outgoing,format:'s16le',rate:VOICE_RATE,voice};
   }finally{busy=false;}
  },
  end(){ended=true;context.clear();},
  get state(){return ended?'ENDED':busy?'BUSY':'READY';}
 };
}
