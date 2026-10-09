import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {evaluateDecision,normalizeSegment,selectAutomationForLead} from '../dashboard/automation-router.mjs';
test('decisões determinísticas distinguem aceite, recusa e ambiguidade',()=>{
 const yes=['sim','pode sim','pode mandar','quero ver','me manda uma prévia do site','quero um exemplo do site'];
 const no=['não','não tenho interesse','agora não','não quero','já tenho site','não, pode sim'];
 const unknown=['talvez depois','preciso pensar','preço?', '1234',''];
 for(const x of yes)assert.equal(evaluateDecision(x,'sample_offer').decision,'YES',x);
 for(const x of no)assert.equal(evaluateDecision(x,'sample_offer').decision,'NO',x);
 for(const x of unknown)assert.equal(evaluateDecision(x,'sample_offer').decision,'REVIEW',x);
 assert.equal(normalizeSegment('Clínica Odontológica'),'clinica odontologica');
 const a={id:'x',name:'Psicólogos',enabled:1,segments_json:'["Psicologia"]',is_default:0};
 const b={id:'y',name:'Geral',enabled:1,segments_json:'[]',is_default:1};
 assert.equal(selectAutomationForLead({segment:'psicologia'},[b,a]).id,'x');
 assert.equal(selectAutomationForLead({segment:'Reformas'},[b,a]).id,'y');
 assert.throws(()=>selectAutomationForLead({segment:'Reformas'},[b,a],'nope'));
});
test('workflow segmentado espera, decide, cria pedido e encerra sem duplicar',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-auto-'));
 try{
  const db=pathToFileURL(path.resolve('dashboard/db.mjs')).href;
  const rt=pathToFileURL(path.resolve('dashboard/runtime.mjs')).href;
  const lines=[
   "import assert from 'node:assert/strict';",
   "import {addLead,one,all,run,getThread} from "+JSON.stringify(db)+";",
   "import {saveWorkflow,startWorkflow,drive,handleDecision} from "+JSON.stringify(rt)+";",
   "const steps=[{id:'a',type:'message',text:'Gostaria de uma prévia?'},{id:'b',type:'wait_reply'},{id:'c',type:'decision',context:'sample_offer',context_description:'Enviei uma pergunta pedindo autorização para criar uma demonstração.',yes_type:'message',yes_text:'Perfeito! Meta de dez minutos.',yes_action:'request_sample',no_type:'message',no_text:'Tudo bem, obrigado!',no_action:'end'},{id:'d',type:'end'}];",
   "const workflowId=saveWorkflow({name:'Odontologia',segments:['Odontologia'],enabled:true,steps});",
   "assert.throws(()=>saveWorkflow({name:'Inválido',steps:[{id:'a',type:'message',text:'ola'}, {id:'b',type:'decision',context:'sample_offer'}, {id:'c',type:'end'}]}));",
   "const w=one('SELECT * FROM workflows WHERE id=?',workflowId);assert.equal(JSON.parse(w.segments_json)[0],'Odontologia');",
   "const lead=addLead({business:'Clínica Cuidado',phone:'15988881234',instagram:'clinica_cuidado',segment:'Odontologia',contact_permission:true}).lead;",
   "const runId=startWorkflow(lead.id);assert.equal(one('SELECT workflow_id FROM executions WHERE id=?',runId).workflow_id,workflowId);",
   "drive(runId);assert.equal(one('SELECT state FROM executions WHERE id=?',runId).state,'SENDING');",
   "run(\"UPDATE jobs SET status='SENT' WHERE execution_id=?\",runId);run(\"UPDATE executions SET state='ACTIVE' WHERE id=?\",runId);drive(runId);",
   "assert.equal(one('SELECT state FROM executions WHERE id=?',runId).state,'WAIT_REPLY');",
   "const response=handleDecision(lead.id,'pode sim',true);assert.equal(response.decision,'YES');",
   "assert.equal(one('SELECT status FROM production_requests WHERE lead_id=?',lead.id).status,'REQUESTED');",
   "assert.equal(one('SELECT state FROM executions WHERE id=?',runId).state,'COMPLETE');",
   "assert.equal(one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id).manual_takeover,1);",
   "assert.equal(one(\"SELECT COUNT(*) AS n FROM jobs WHERE key LIKE 'decision:%'\").n,1);",
   "assert.equal(handleDecision(lead.id,'pode sim',true),null);",
   "assert.equal(one('SELECT COUNT(*) AS n FROM production_requests').n,1);",
   "const no=addLead({business:'Outra clínica',phone:'15988880001',instagram:'outra_clinica',segment:'Odontologia',contact_permission:true}).lead;",
   "const noRun=startWorkflow(no.id);drive(noRun);run(\"UPDATE jobs SET status='SENT' WHERE execution_id=?\",noRun);run(\"UPDATE executions SET state='ACTIVE' WHERE id=?\",noRun);drive(noRun);",
   "assert.equal(handleDecision(no.id,'Não tenho interesse',true).decision,'NO');",
   "assert.equal(one('SELECT stage FROM leads WHERE id=?',no.id).stage,'NO_INTEREST');",
   "assert.equal(one('SELECT id FROM production_requests WHERE lead_id=?',no.id),undefined);",
   "assert.equal(one(\"SELECT COUNT(*) AS n FROM jobs WHERE lead_id=? AND key LIKE 'decision:%'\",no.id).n,1);",
   "assert.throws(()=>startWorkflow(no.id));",
   "const maybe=addLead({business:'Mais uma clínica',phone:'15988880002',instagram:'mais_uma_clinica',segment:'Odontologia',contact_permission:true}).lead;",
   "const mRun=startWorkflow(maybe.id);drive(mRun);run(\"UPDATE jobs SET status='SENT' WHERE execution_id=?\",mRun);run(\"UPDATE executions SET state='ACTIVE' WHERE id=?\",mRun);drive(mRun);",
   "assert.equal(handleDecision(maybe.id,'talvez depois',true).decision,'REVIEW');",
   "assert.equal(one('SELECT state FROM executions WHERE id=?',mRun).state,'NEEDS_REVIEW');",
   "assert.equal(one(\"SELECT COUNT(*) AS n FROM jobs WHERE lead_id=? AND key LIKE 'decision:%'\",maybe.id).n,0);"
  ];
  const target=path.join(tmp,'run.mjs');fs.writeFileSync(target,lines.join('\n'));
  const p=spawnSync(process.execPath,[target],{cwd:tmp,encoding:'utf8',timeout:25000});
  assert.equal(p.status,0,'stdout: '+p.stdout+'\nstderr: '+p.stderr);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
