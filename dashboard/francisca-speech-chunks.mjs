// Progressive, sentence-bound audio synthesis. Full text is already validated;
// these segments do not bypass the model/tool approval state.
export function splitSpeech(text,{maxChars=175,maxSegments=5}={}){
 const input=String(text||'').replace(/\s+/g,' ').trim();
 if(!input)return [];
 if(input.length<=maxChars)return [input];
 const words=input.split(' '),parts=[];let line='';
 for(const word of words){
  if((line+' '+word).trim().length<=maxChars){line=(line+' '+word).trim();continue;}
  if(line)parts.push(line);
  line=word;
 }
 if(line)parts.push(line);
 // Bound TTS calls by merging later sentences, never dropping content.
 while(parts.length>maxSegments){
  const tail=parts.pop();parts[parts.length-1]+=' '+tail;
 }
 return parts;
}
export async function synthesizeSpeechChunks(text,{synthesize,onSegment,maxSegments=5,maxChars=175}={}){
 if(typeof synthesize!=='function')throw Error('CHUNK_TTS_REQUIRED');
 const parts=splitSpeech(text,{maxSegments,maxChars});
 if(!parts.length)throw Error('CHUNK_TEXT_EMPTY');
 const buffers=[];let total=0;
 // Start the next synthesis while the caller is hearing the current segment.
 let promise=Promise.resolve().then(()=>synthesize(parts[0],0));
 for(let i=0;i<parts.length;i++){
  const segment=await promise;
  promise=i+1<parts.length?Promise.resolve().then(()=>synthesize(parts[i+1],i+1)):null;
  const pcm=segment?.pcm16k;
  if(!Buffer.isBuffer(pcm)||pcm.length<2||pcm.length%2||pcm.length>16000*2*65)
   throw Error('CHUNK_PCM_INVALID');
  buffers.push(pcm);total+=pcm.length;
  if(total>16000*2*65)throw Error('CHUNK_PCM_EXCEEDS_LIMIT');
  if(onSegment)await onSegment({pcm16k:pcm,index:i,total:parts.length});
 }
 return {pcm16k:Buffer.concat(buffers),segments:parts.length};
}
