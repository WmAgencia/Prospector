// Text-to-speech uses Microsoft Francisca voice through edge-tts (unofficial).
// No automatic sending. Converts generated MP3 to WhatsApp-compatible AAC/M4A.
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
const execFile=promisify(execFileCallback);
export const FRANCISCA='pt-BR-FranciscaNeural';
export function voiceStatus(){
 return {voice:FRANCISCA,language:'pt-BR',female:true,provider:'edge-tts',
  available:process.env.FRANCISCA_TTS_ENABLED==='true',
  defaultRate:'-3%',pitch:'+0Hz',format:'audio/mp4',
  disclosure:'Síntese por serviço online não oficial do Edge; depende da disponibilidade externa.'};
}
export function checkVoiceText(text){
 const value=String(text||'').trim().replace(/\s+/g,' ');
 if(value.length<2||value.length>650)throw Error('VOICE_TEXT_LENGTH');
 return value;
}
export async function makeFranciscaVoice(text,{exec=execFile,read=readFile,makeTemp=mkdtemp,remove=rm}={}){
 if(process.env.FRANCISCA_TTS_ENABLED!=='true')throw Error('FRANCISCA_DISABLED');
 const sentence=checkVoiceText(text),dir=await makeTemp(path.join(tmpdir(),'francisca-'));
 const mp3=path.join(dir,'audio.mp3'),mp4=path.join(dir,'voice.m4a');
 try{
  // Passing text in argv (not a shell) prevents command injection.
  await exec('/opt/francisca/bin/edge-tts',['--voice',FRANCISCA,
   '--rate=-3%','--pitch=+0Hz','--volume=+0%',
   '--text',sentence,'--write-media',mp3,'--no-progress'],{timeout:24000,maxBuffer:120000});
  const data=await stat(mp3);if(data.size<256||data.size>5*1024*1024)throw Error('VOICE_INVALID_OUTPUT');
  await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp3,'-vn',
    '-ac','1','-ar','24000','-codec:a','aac','-b:a','64k','-movflags','+faststart',mp4],
    {timeout:15000,maxBuffer:120000});
  const bytes=await read(mp4);
  if(bytes.length<256||bytes.length>5*1024*1024)throw Error('VOICE_INVALID_OUTPUT');
  return {bytes,mimeType:'audio/mp4',voice:FRANCISCA};
 }finally{await remove(dir,{recursive:true,force:true}).catch(()=>{});}
}


// Low-latency phone-call path. edge-tts emits MP3; decode it directly to
// 16kHz mono PCM16 instead of encoding to AAC/M4A and decoding back to PCM.
// Unlike WhatsApp voice messages, the VoIP bridge never needs an M4A file.
export async function makeFranciscaCallPcm(text,{exec=execFile,read=readFile,makeTemp=mkdtemp,remove=rm,rate='+4%'}={}){
 if(process.env.FRANCISCA_TTS_ENABLED!=='true')throw Error('FRANCISCA_DISABLED');
 const validRate=['-13%','+4%','+13%'].includes(rate)?rate:'+4%';
 const sentence=checkVoiceText(text),dir=await makeTemp(path.join(tmpdir(),'francisca-live-'));
 const mp3=path.join(dir,'speech.mp3'),pcm=path.join(dir,'speech.pcm');
 try{
  await exec('/opt/francisca/bin/edge-tts',['--voice',FRANCISCA,'--rate='+validRate,
   '--pitch=+0Hz','--volume=+0%','--text',sentence,'--write-media',mp3,
   '--no-progress'],{timeout:24000,maxBuffer:120000});
  const size=await stat(mp3);
  if(size.size<256||size.size>5*1024*1024)throw Error('VOICE_INVALID_OUTPUT');
  await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp3,
   '-vn','-ac','1','-ar','16000','-f','s16le','-acodec','pcm_s16le',pcm],
   {timeout:15000,maxBuffer:120000});
  const pcm16k=await read(pcm);
  if(!Buffer.isBuffer(pcm16k)||pcm16k.length<3200||
     pcm16k.length>16000*2*60||pcm16k.length%2)throw Error('VOICE_PCM_INVALID');
  return {pcm16k,voice:FRANCISCA,sampleRate:16000};
 }finally{await remove(dir,{recursive:true,force:true}).catch(()=>{});}
}
