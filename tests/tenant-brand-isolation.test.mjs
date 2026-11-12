import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Use an independent process and SQLite directory for each simulated company.
// No API keys, internet requests, WhatsApp sessions or real customer data.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-tenant-brand-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

function scenario({business,internal=false,audience='PROSPECT_APPROACHED'}={}){
 const dataDir=path.join(root,crypto.randomUUID());
 const script=`
  import {setSetting} from './dashboard/db.mjs';
  import {storeTrainingMarkdown} from './dashboard/training-markdown.mjs';
  import {buildAiDraftSystemPrompt} from './dashboard/ai-groq.mjs';
  import {compactChatHistory} from './dashboard/francisca-chat-coach.mjs';
  import {analyzeSalesConversation} from './dashboard/sales-intelligence.mjs';
  if(process.env.PROSPECTOR_TENANT_INTERNAL!=='true'){
   const company=process.env.TEST_COMPANY;
   setSetting('training_business',{name:company,description:'Prestação de serviços conforme o cadastro da empresa'});
   const doc='# Manual privado — '+company+'\\n\\n- Empresa: '+company+'\\n- Serviço: manutenção especializada\\n- Preço: somente orçamento validado pela empresa\\n- O atendimento deve se apresentar com a marca cadastrada.\\n';
   const f=storeTrainingMarkdown('active',doc);
   setSetting('training_active',{id:'test-'+company,source:'manual',filename:f.filename,sha256:f.sha256,format:'markdown',at:new Date().toISOString()});
  }
  const context=buildAiDraftSystemPrompt({audience:process.env.TEST_AUDIENCE,dialogueState:{hasAssistantReply:true},profile:analyzeSalesConversation({text:'Quem fala?'} )});
  const assistantLabel=process.env.PROSPECTOR_TENANT_INTERNAL==='true'?'Consecom':'Assistente';
  const history=compactChatHistory([{direction:'out',body:'Olá, sou a assistente da empresa.'},{direction:'in',body:'Pode explicar a proposta?'}],3100,assistantLabel);
  console.log('AUDIT_RESULT='+JSON.stringify({context,history}));
 `;
 const env={...process.env,PROSPECTOR_DATA_DIR:dataDir,PROSPECTOR_SESSION_DIR:path.join(dataDir,'wa-session'),
   PROSPECTOR_TENANT_ID:crypto.randomUUID(),PROSPECTOR_TENANT_INTERNAL:internal?'true':'false',
   PROSPECTOR_TENANT_NAME:'Cadastro de '+business,TEST_COMPANY:business,TEST_AUDIENCE:audience,
   GROQ_API_KEY:'',WA_AKG_API_KEY:'',WA_AKG_SESSION_ID:'',WA_AKG_ADMIN_EMAIL:'',
   PROSPECTOR_FORCE_OUTREACH_PAUSE:'true',PROSPECTOR_OWNER_OPERATIONS_ENABLED:'false'};
 for(const key of Object.keys(env))if(key.startsWith('RUN_'))delete env[key];
 const stdout=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env,encoding:'utf8',timeout:20000});
 const payload=stdout.split('\n').find(s=>s.startsWith('AUDIT_RESULT='));
 assert.ok(payload,'fixture must emit isolated prompt');
 return JSON.parse(payload.slice('AUDIT_RESULT='.length));
}

test('client A uses only its own brand and commercial documentation',()=>{
 const a=scenario({business:'Oficina Aurora'});
 assert.match(a.context,/assistente virtual da Oficina Aurora/i);
 assert.match(a.context,/manual comercial privado/i);
 assert.doesNotMatch(a.context,/Consecom|Wesley|R\\$\\s*550|R\\$\\s*350/i);
 assert.match(a.history,/Assistente:/);
 assert.doesNotMatch(a.history,/Consecom:/);
});

test('client B cannot inherit company A or Consecom instructions',()=>{
 const b=scenario({business:'Clínica Exemplo'});
 assert.match(b.context,/assistente virtual da Clínica Exemplo/i);
 assert.doesNotMatch(b.context,/Oficina Aurora|Consecom|Wesley|R\\$\\s*550|R\\$\\s*350/i);
 assert.doesNotMatch(b.history,/Consecom:/);
});

test('client prospect support also keeps its own brand in a continuing chat',()=>{
 const a=scenario({business:'Papelaria Planalto',audience:'INBOUND_NEW'});
 assert.match(a.context,/IDENTIDADE DA EMPRESA DESTA SESSÃO/i);
 assert.match(a.context,/Papelaria Planalto/i);
 assert.doesNotMatch(a.context,/Consecom|Wesley/i);
});

test('Consecom internal workspace retains original owner-only campaign guidance',()=>{
 const owner=scenario({business:'Consecom Brasil',internal:true});
 assert.match(owner.context,/assistente virtual da Consecom/i);
 assert.match(owner.context,/Wesley/i);
 assert.match(owner.history,/Consecom:/);
});

test('production sales automation labels tenant conversation history neutrally',()=>{
 const sales=fs.readFileSync(new URL('../dashboard/groq-sales-automation.mjs',import.meta.url),'utf8');
 assert.match(sales,/const assistantLabel=externalTenant\\?'Assistente':'Consecom'/);
 assert.match(sales,/compactChatHistory\\(recentTurns,3100,assistantLabel\\)/);
});
