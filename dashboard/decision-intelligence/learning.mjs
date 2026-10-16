// Aprendizado local opcional de Naive Bayes: SOMENTE exemplos rotulados
// pelo operador, nunca respostas classificadas automaticamente.
// Guarda contagens de tokens, nao o texto original das conversas.
import {db,all,one,run,id,now,audit} from '../db.mjs';
import {tokenize,contexts} from './engine.mjs';
db.exec("CREATE TABLE IF NOT EXISTS decision_examples(id TEXT PRIMARY KEY,context TEXT NOT NULL,label TEXT NOT NULL,tokens TEXT NOT NULL,at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_decision_example_context ON decision_examples(context,label)");
const labels=['YES','NO','REVIEW'];
export function labelExample({text,context='general_interest',label}={}){
 if(!contexts.includes(context))throw Error('Contexto de exemplo inválido');
 if(!labels.includes(label))throw Error('Decisão de exemplo inválida');
 const raw=String(text??'');
 if(raw.length<2||raw.length>800)throw Error('Texto de exemplo deve ter entre 2 e 800 caracteres');
 const tokens=[...new Set(tokenize(raw))].slice(0,45);
 if(!tokens.length)throw Error('Exemplo sem palavras úteis');
 const existing=one("SELECT id FROM decision_examples WHERE context=? AND label=? AND tokens=?",context,label,JSON.stringify(tokens));
 if(existing)return {created:false,id:existing.id};
 const sampleId=id();
 run('INSERT INTO decision_examples(id,context,label,tokens,at) VALUES(?,?,?,?,?)',sampleId,context,label,JSON.stringify(tokens),now());
 audit('DECISION_LABEL_RECORDED',null,{context,label,tokenCount:tokens.length});
 return {created:true,id:sampleId};
}
export function modelStatistics(context='general_interest'){
 if(!contexts.includes(context))throw Error('Contexto inválido');
 const counts=all('SELECT label,COUNT(*) n FROM decision_examples WHERE context=? GROUP BY label',context);
 const c=Object.fromEntries(labels.map(k=>[k,counts.find(x=>x.label===k)?.n||0]));
 return {context,total:counts.reduce((n,x)=>n+x.n,0),counts:c,
  ready:c.YES>=5&&c.NO>=5&&c.REVIEW>=5,method:'Multinomial Naive Bayes, amostras rotuladas manualmente',calibrated:false,
  caveat:'As probabilidades são relativas ao conjunto de exemplos; não são taxas de acerto garantidas.'};
}
export function modelPredict(text,context='general_interest'){
 const stats=modelStatistics(context);
 if(!stats.ready)return {supported:false,reason:'insufficient_manually_labeled_examples',...stats};
 const terms=tokenize(text).slice(0,45);
 if(!terms.length)return {supported:false,reason:'no_tokens',...stats};
 const rows=all('SELECT label,tokens FROM decision_examples WHERE context=?',context);
 const freq=Object.fromEntries(labels.map(k=>[k,new Map()]));
 const totalWords=Object.fromEntries(labels.map(k=>[k,0]));
 const vocab=new Set();
 for(const r of rows){
  let tokens=[];try{tokens=JSON.parse(r.tokens||'[]');}catch{}
  for(const word of tokens){vocab.add(word);const f=freq[r.label];f.set(word,(f.get(word)||0)+1);totalWords[r.label]++;}
 }
 const scores={};
 for(const label of labels){
  let log=Math.log((stats.counts[label]+1)/(stats.total+labels.length));
  for(const term of terms)log+=Math.log(((freq[label].get(term)||0)+1)/(totalWords[label]+vocab.size+1));
  scores[label]=log;
 }
 const max=Math.max(...Object.values(scores)),exp=Object.fromEntries(labels.map(k=>[k,Math.exp(scores[k]-max)])),den=labels.reduce((n,k)=>n+exp[k],0);
 const values=Object.fromEntries(labels.map(k=>[k,Number((exp[k]/den).toFixed(4))]));
 const order=[...labels].sort((a,b)=>values[b]-values[a]);
 return {supported:true,label:order[0],confidence:values[order[0]],distribution:values,context,
  trainedExamples:stats.total,calibrated:false};
}
