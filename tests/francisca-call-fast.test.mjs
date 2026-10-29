import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {makeFranciscaCallPcm} from '../dashboard/francisca-tts.mjs';

test('phone-call TTS produces PCM16 directly without AAC and cleans temporary files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'francisca-pcm-unit-'));
 let commands=[],seen;
 const fakeExec=async(cmd,args)=>{
  commands.push({cmd,args});
  const dest=args[args.length-1];
  if(cmd.includes('edge-tts'))await writeFile(args[args.indexOf('--write-media')+1],Buffer.alloc(900));
  if(cmd==='ffmpeg'){assert(args.includes('s16le'));assert(args.includes('16000'));assert(!args.includes('aac'));
   await writeFile(dest,Buffer.alloc(12000));}
 };
 try{
  const result=await makeFranciscaCallPcm('Oi, tudo bem?',{
   exec:fakeExec,read:async f=>(await import('node:fs/promises')).readFile(f),
   makeTemp:async()=>root,
   remove:async p=>{seen=p;await rm(p,{force:true,recursive:true});}
  });
  assert.equal(result.sampleRate,16000);
  assert.equal(result.pcm16k.length,12000);
  assert.equal(commands.length,2);
  assert.equal(seen,root);
  await assert.rejects(stat(root),{code:'ENOENT'});
 }finally{await rm(root,{force:true,recursive:true});}
});
test('call TTS validates output and still cleans on PCM failure',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'francisca-pcm-failure-'));
 try{
  await assert.rejects(makeFranciscaCallPcm('Alô',{exec:async(cmd,args)=>{
   if(cmd.includes('edge-tts'))await writeFile(args[args.indexOf('--write-media')+1],Buffer.alloc(900));
   else await writeFile(args.at(-1),Buffer.alloc(3));
  },read:async f=>(await import('node:fs/promises')).readFile(f),
   makeTemp:async()=>root,remove:async p=>rm(p,{recursive:true,force:true})
  }),/VOICE_PCM_INVALID/);
  await assert.rejects(stat(root),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
