// User-friendly view over the tenant-private, approved Francisca manual.
// The underlying .md remains authoritative, never shown as raw Markdown.
import crypto from 'node:crypto';
import {getSetting,setSetting,now} from './db.mjs';
import {readTrainingMarkdown,storeTrainingMarkdown} from './training-markdown.mjs';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,20);
export function conciseTrainingSummary(lines){
 const options=(Array.isArray(lines)?lines:[])
  .map(x=>String(x||'').replace(/\s+/g,' ').trim())
  .filter(x=>x.length>=18&&!/^(versão|escopo|idioma|fonte|arquivo|documento):/i.test(x)&&!/^[-–—|#`*_]+$/.test(x));
 const selected=options.slice(0,2);
 if(!selected.length)return 'Abra as orientações para conferir o que a Francisca pode fazer e responder.';
 let short=selected[0].replace(/^\d+[.)]\s*/,'');
 if(short.length<105&&selected[1])short+=' • '+selected[1].replace(/^\d+[.)]\s*/,'');
 if(short.length<=210)return short;
 const cropped=short.slice(0,207).replace(/\s+\S*$/,'').replace(/[.,;:!?\s-]+$/,'');
 return cropped+'…';
}

const text=v=>String(v||'').replace(/\r\n?/g,'\n');
export function reviewSections(markdown){
 const value=text(markdown);
 if(!value.trim())return [];
 const split=value.split(/(?=^## (?!#))/m);
 let offset=0;
 return split.map((raw,index)=>{
  const start=offset;offset+=raw.length;
  const heading=/^## ([^\n]+)/m.exec(raw);
  const title=heading?heading[1].replace(/[*_]/g,'').trim():'Informações gerais';
  const body=heading?raw.replace(/^## [^\n]*\n?/, '').trim():raw.trim();
  const lines=body.split('\n').map(x=>x.trim()).filter(Boolean);
  const plain=lines.map(line=>line.replace(/^#{1,6}\s+/, '').replace(/^>\s*/, '').replace(/^[-*+]\s+/, '').replace(/\*\*|__/g,'').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'$1 ($2)')).filter(Boolean);
  return {id:sha(index+'|'+raw),index,start,title,body,
   summary:conciseTrainingSummary(plain),
   points:plain.slice(0,80),editText:plain.join('\n'),count:plain.length,raw};
 });
}
export function publicReviewCards(markdown){
 const sections=reviewSections(markdown);
 // File titles and frontmatter are not themselves a learned behavior.
 const visible=sections.length>1?sections.filter(c=>c.index!==0||/^\s*[-*+]\s+\S/m.test(c.raw)):sections;
 return visible.map(({id,index,title,summary,points,editText,count})=>({id,index,title,summary,points,editText,count}));
}
export function reviewTextState(active,existingDraft){
 const draftText=existingDraft?.text||'';
 const markdown=draftText||active||'';
 return {cards:publicReviewCards(markdown),hasPendingReview:!!existingDraft,
  version:sha(markdown),canApprove:!!existingDraft,source:existingDraft?.source||'active'};
}
const safeTitle=s=>String(s||'').replace(/[\r\n#<>]/g,' ').trim().slice(0,110);
function safeBody(v){
 const body=text(v).trim();
 if(body.length<12||body.length>16000)throw Error('Escreva uma orientação com 12 a 16.000 caracteres');
 return body;
}
export function modifyReviewMarkdown(markdown,{action,index,cardId,title,body,version}={}){
 const original=text(markdown);
 if(version&&sha(original)!==version)throw Error('O treinamento foi atualizado. Atualize a página antes de editar');
 const parts=reviewSections(original);
 const nextTitle=safeTitle(title);
 if(action==='delete'){
  const card=parts.find(x=>x.index===index&&x.id===cardId);
  if(!card)throw Error('Orientação alterada ou não encontrada. Atualize a página');
  const pos=card.start;
  if(original.slice(pos,pos+card.raw.length)!==card.raw)throw Error('Versão desatualizada');
  const updated=(original.slice(0,pos)+original.slice(pos+card.raw.length)).replace(/\n{3,}/g,'\n\n').trim();
  return updated.length>=20?updated+'\n':'# Orientações da empresa\n\nNenhuma orientação comercial específica aprovada.\n';
 }
 if(action==='add'){
  if(!nextTitle||nextTitle.length<3)throw Error('Informe um título para a orientação');
  const entry='## '+nextTitle+'\n\n'+safeBody(body);
  const updated=(original.trimEnd()+'\n\n'+entry+'\n').trimStart();
  if(updated.length>17900)throw Error('O treinamento atingiu o limite de tamanho');
  return updated;
 }
 if(action!=='edit')throw Error('Edição desconhecida');
 const card=parts.find(x=>x.index===index&&x.id===cardId);
 if(!card)throw Error('Orientação alterada ou não encontrada. Atualize a página');
 if(!nextTitle||nextTitle.length<3)throw Error('Informe um título para a orientação');
 const replacement='## '+nextTitle+'\n\n'+safeBody(body);
 const start=card.start;
 if(original.slice(start,start+card.raw.length)!==card.raw)throw Error('Versão desatualizada');
 const changed=original.slice(0,start)+replacement+'\n\n'+original.slice(start+card.raw.length);
 if(changed.length>17900)throw Error('O treinamento atingiu o limite de tamanho');
 return changed;
}
export function createCardDraft(input,activeMarkdown){
 const existing=getSetting('training_draft',null);
 const before=(existing?.source==='interview'?readTrainingMarkdown('draft'):null)||existing?.text||activeMarkdown||'';
 const next=modifyReviewMarkdown(before,input);
 const interview=existing?.source==='interview';
 // Keep verified interview settings (business identity and closing mode) when
 // the manager edits the draft as cards. The interview draft is file-backed.
 if(interview)storeTrainingMarkdown('draft',next);
 const draft=interview?{...existing,id:crypto.randomUUID(),source:'interview',text:next,at:now()}:
  {id:crypto.randomUUID(),source:'cards',text:next,at:now()};
 setSetting('training_draft',draft);
 return {draft,review:reviewTextState(activeMarkdown,draft)};
}
