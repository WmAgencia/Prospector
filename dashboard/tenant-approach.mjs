// Tenant's first-contact text comes only from its approved Markdown.
// The master account's pre-existing two-stage Consecom/Wesley approach is untouched.
import crypto from 'node:crypto';
import {getSetting} from './db.mjs';
import {readTrainingMarkdown} from './training-markdown.mjs';
import {greetingName} from './portfolio-offer-550.mjs';
const LIMIT=420;
const clean=(s,max=95)=>String(s||'').replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const findField=(markdown,label)=>{
 // Interview Markdown renders the colon *inside* the bold label; accept the
 // outside-colon variant too when the owner manually edits the .md.
 const prefixes=['- **'+label+':**','- **'+label+'**:'];
 for(const line of String(markdown||'').split('\n')){
  const content=line.trimStart(),prefix=prefixes.find(p=>content.startsWith(p));
  if(prefix)return content.slice(prefix.length).trim();
 }
 return '';
};
export function tenantApprovedApproach(){
 if(!process.env.PROSPECTOR_TENANT_ID)return null;
 const profile=getSetting('training_active',null);
 if(!profile)return null;
 const text=readTrainingMarkdown('active');
 if(!text)return null;
 if(profile.sha256&&crypto.createHash('sha256').update(text).digest('hex')!==profile.sha256)
  throw Error('TRAINING_MARKDOWN_INTEGRITY_MISMATCH');
 const header='## Estratégia de primeira abordagem';
 const start=text.indexOf(header);
 if(start<0)return null;
 const tail=text.slice(start+header.length);
 const sectionEnd=tail.search(/^## /m);
 const section=sectionEnd>=0?tail.slice(0,sectionEnd):tail;
 const mode=findField(section,'Código da estratégia');
 if(!['permission','direct','consultative','friendly','custom'].includes(mode))return null;
 const template=findField(section,'Mensagem inicial aprovada');
 if(template.length<12||template.length>LIMIT)return null;
 const company=clean(findField(text,'Nome')||getSetting('training_business',{})?.name||process.env.PROSPECTOR_TENANT_NAME,90);
 const service=clean(/^### 1\.\s*(.+)$/m.exec(text)?.[1],90);
 if(!company||(template.includes('{{servico}}')&&!service))return null;
 return {mode,template,company,service};
}
export function tenantApproachGreeting(lead={}){
 const approach=tenantApprovedApproach();
 if(!approach)return null;
 const known=clean(greetingName(lead),30);
 // The "comma + name" fragment is optional; avoid broken greetings when no name is known.
 const namedTemplate=approach.template.replace(/,\s*\{\{nome\}\}/g,known?', '+known:'');
 const message=namedTemplate.replace(/\{\{(nome|empresa|servico)\}\}/g,(match,key)=>
  key==='nome'?known:key==='empresa'?approach.company:approach.service);
 if(/\{\{[^}]{1,60}\}\}/.test(message))return null;
 return message.replace(/\s+/g,' ').replace(/\s+([!?.,])/g,'$1').trim().slice(0,LIMIT);
}
