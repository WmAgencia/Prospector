import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-owner-seed-'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
function childRun(name,{external=true,mode='inspect'}={}){
 const folder=path.join(dir,name);
 const env={...process.env,PROSPECTOR_DATA_DIR:folder,PROSPECTOR_TENANT_ID:external?crypto.randomUUID():'',
  PROSPECTOR_TENANT_INTERNAL:external?'false':'true',PROSPECTOR_TENANT_NAME:'Empresa Fictícia',
  GROQ_API_KEY:'',WA_AKG_API_KEY:'',WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',MODE:mode};
 for(const k of Object.keys(env))if(k.startsWith('RUN_'))delete env[k];
 const script=`
  import {all,one,run,id,setSetting,getSetting,now} from './dashboard/db.mjs';
  import {CAMPAIGN_NAME} from './dashboard/consecom-flow.mjs';
  if(process.env.MODE==='legacy'){
   const identifier=id();
   run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',
    identifier,CAMPAIGN_NAME,0,1,'[]',now(),now(),'[]',0);
   setSetting('consecom_campaign_seed_id',identifier);
   setSetting('campaign_offer_price',350);setSetting('site_average_price_brl',550);
   setSetting('tenant_commercial_seed_isolated_v1',false);
  }else if(process.env.MODE==='edited'){
   const identifier=id();
   run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',
    identifier,CAMPAIGN_NAME,0,1,'[]',now(),now(),'[]',1);
   setSetting('consecom_campaign_seed_id',identifier);
   setSetting('tenant_commercial_seed_isolated_v1',false);
  }
  console.log('RESULT='+JSON.stringify({
   workflows:all('SELECT id,name,is_default,enabled FROM workflows ORDER BY name'),
   seedId:getSetting('consecom_campaign_seed_id',''),
   price:getSetting('campaign_offer_price','missing'),
   average:getSetting('site_average_price_brl','missing'),
   migrated:getSetting('tenant_commercial_seed_isolated_v1',false)
  }));
 `;
 const out=execFileSync(process.execPath,['--input-type=module','-e',script],{
  cwd:process.cwd(),env,encoding:'utf8',timeout:20000});
 const line=out.split('\n').find(x=>x.startsWith('RESULT='));
 assert.ok(line);return JSON.parse(line.slice(7));
}

test('new client has only neutral workflows and no Consecom pricing',()=>{
 const x=childRun('fresh');
 assert.equal(x.workflows.some(w=>/Consecom/i.test(w.name)),false);
 assert.equal(x.workflows.length,1);
 assert.equal(x.price,null);
 assert.equal(x.average,null);
 assert.equal(x.migrated,true);
});

test('existing external client loses only the untouched inactive legacy seed',()=>{
 childRun('legacy',{mode:'legacy'});
 const x=childRun('legacy');
 assert.equal(x.workflows.some(w=>/Consecom/i.test(w.name)),false);
 assert.equal(x.workflows.length,1);
 assert.equal(x.seedId,'');
 assert.equal(x.price,null);
 assert.equal(x.average,null);
 assert.equal(x.migrated,true);
});

test('customer-modified active workflows are never deleted',()=>{
 childRun('edited',{mode:'edited'});
 const x=childRun('edited');
 assert.ok(x.workflows.some(w=>/Consecom/i.test(w.name)&&w.enabled===1));
 assert.ok(x.seedId,'user-selected or edited campaign is preserved for manual review');
});

test('Consecom internal account keeps its approved historic campaign',()=>{
 const x=childRun('owner',{external:false});
 assert.ok(x.workflows.some(w=>/Consecom/i.test(w.name)));
 assert.equal(x.price,350);
 assert.equal(x.average,550);
});
