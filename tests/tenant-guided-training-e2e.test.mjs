import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-guided-training-'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100}));
const source=String.raw`
 import assert from 'node:assert/strict';
 import {getSetting} from './dashboard/db.mjs';
 import {startTrainingInterview,advanceTrainingInterview,trainingInterviewStatus} from './dashboard/francisca-training-interview.mjs';
 import {handleTraining,readActiveTrainingMarkdown} from './dashboard/training.mjs';
 import {readTrainingMarkdown} from './dashboard/training-markdown.mjs';
 const company=process.env.TEST_COMPANY,other=process.env.TEST_OTHER;
 const answers={
  company,audience:'Pessoas adultas procurando serviços profissionais',
  services:'manutenção de equipamentos',
  service_detail:'Reparo e manutenção preventiva com orçamento após avaliação',
  service_price:'Orçamento personalizado',
  region:'Atendemos Sorocaba e região',
  process:'O cliente envia fotos e recebe avaliação da equipe',
  qualify:'Perguntar o modelo e descrever o problema',
  style:'Tom natural e objetivo, sem respostas repetidas',
  objections:'Sem descontos não autorizados e sem afirmar resultado garantido',
  social_proof:'Não tenho',
  handoff:'Transferir quando pedir um humano ou quiser contratar',
  restrictions:'Nunca oferecer preço sem orçamento aprovado',
  notification:'depois',closing_mode:'1',approach:'1'
 };
 let state=startTrainingInterview('text');
 let count=0;
 while(!state.completed&&count<25){
  const answer=answers[state.step];
  assert.ok(answer,'missing answer for '+state.step);
  state=advanceTrainingInterview(answer);
  count++;
 }
 assert.equal(state.completed,true,'interview reaches review state');
 assert.equal(state.progress,100);
 const draft=getSetting('training_draft',null);
 assert.equal(draft.source,'interview');
 const markdown=readTrainingMarkdown('draft');
 assert.match(markdown,new RegExp(company));
 assert.doesNotMatch(markdown,new RegExp(other));
 assert.equal(readActiveTrainingMarkdown(),null,'draft does not activate IA');
 let approved;
 await handleTraining({method:'POST'},null,new URL('http://unit.test/api/training/approve'),{
  json:async()=>({id:draft.id,text:markdown}),
  respond:(_res,status,body)=>approved={status,body}
 });
 assert.equal(approved.status,200);
 assert.equal(approved.body.profile?.source,'interview');
 assert.equal(getSetting('training_business').name,company);
 assert.match(readActiveTrainingMarkdown(),new RegExp(company));
 assert.doesNotMatch(readActiveTrainingMarkdown(),new RegExp(other));
 let edit;
 await handleTraining({method:'POST'},null,new URL('http://unit.test/api/training/edit'),{
  json:async()=>({}),respond:(_res,status,body)=>edit={status,body}
 });
 assert.equal(edit.status,200);
 assert.equal(edit.body.draft?.source,'edit');
 assert.match(edit.body.draft?.text||'',new RegExp(company));
 console.log('GUIDED_TENANT='+JSON.stringify({company,interviewSteps:count,approved:true,editable:true,
  noCrossTenantBrand:true,automaticProspection:false,externalMessagesSent:0}));
`;
async function run(label,other){
 const env={...process.env,PROSPECTOR_TENANT_ID:crypto.randomUUID(),
  PROSPECTOR_TENANT_NAME:label,PROSPECTOR_TENANT_INTERNAL:'false',
  PROSPECTOR_DATA_DIR:path.join(dir,label.replaceAll(' ','-')),
  WA_AKG_API_KEY:'',WA_AKG_ADMIN_PASSWORD:'',GROQ_API_KEY:'',
  PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false',
  TEST_COMPANY:label,TEST_OTHER:other};
 for(const k of Object.keys(env))if(k.startsWith('RUN_'))delete env[k];
 const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x.toString());child.stderr.on('data',x=>stderr+=x.toString());
 const exit=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('training timed out'));},25000);
  child.on('close',x=>{clearTimeout(timer);resolve(x)});child.on('error',reject);
 });
 assert.equal(exit,0,stderr.slice(0,3500));
 const result=stdout.split('\n').find(x=>x.startsWith('GUIDED_TENANT='));
 assert.ok(result,stdout.slice(0,1200));
 return JSON.parse(result.slice(14));
}
test('two companies autonomously train and approve their own Francisca profiles',async()=>{
 const a=await run('Oficina Aurora','Clinica Encanto');
 const b=await run('Clinica Encanto','Oficina Aurora');
 assert.ok(a.approved&&a.editable&&b.approved&&b.editable);
 assert.ok(a.interviewSteps>=12&&b.interviewSteps>=12);
},{timeout:65000});
