// Tenant-private sales evidence and closing settings. Never use client A values in client B.
// The global sales manual contains methods only; these are per-tenant facts.
import crypto from 'node:crypto';
import {one,getSetting,setSetting,now} from './db.mjs';
import {saveSalesContextMarkdown} from './sales-training-documents.mjs';

const evidenceKey='training_social_evidence_v1';
const closeKey='training_sales_closing_v1';
// Consecom chose full closing with 50% entry. Never request a PIX without a configured key.
if((process.env.PROSPECTOR_TENANT_INTERNAL==='true'||!process.env.PROSPECTOR_TENANT_ID)&&!getSetting(closeKey,null))setSetting(closeKey,{mode:'complete',methods:['pix'],depositPercent:50,pixKey:'',pixName:'',notifyOn:'receipt',at:now()});
const validKinds=new Set(['portfolio','testimonial','case','other']);
const clean=(value,max=500)=>String(value||'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const linkAllowed=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.indexOf('.')>0&&value.length<=700?u.href:null;}catch{return null;}};
const mediaAllowed=id=>{
 const m=one('SELECT id,name,mime,kind,bytes FROM media WHERE id=?',String(id||''));
 return ((m?.kind==='image'&&['image/jpeg','image/png','image/webp'].includes(m.mime))||(m?.kind==='document'&&m.mime==='application/pdf'))&&m.bytes<=8*1024*1024?m:null;
};
function readEvidence(){return getSetting(evidenceKey,{items:[]});}
export function evidenceStatus(){
 const items=(readEvidence().items||[]).map(({id,kind,title,description,url,mediaId,approved,createdAt})=>({id,kind,title,description,url,mediaId,approved,createdAt}));
 return {items,approved:items.filter(x=>x.approved),pending:items.filter(x=>!x.approved)};
}
export function addSalesEvidence(input={}){
 const kind=clean(input.kind,25)||'portfolio',title=clean(input.title,120),description=clean(input.description,350);
 if(!validKinds.has(kind)||title.length<3)throw Error('Informe tipo e título da prova social.');
 const url=input.url?linkAllowed(String(input.url).trim()):null;
 if(input.url&&!url)throw Error('Informe um link HTTPS válido.');
 const media=input.mediaId?mediaAllowed(input.mediaId):null;
 if(input.mediaId&&!media)throw Error('Imagem não encontrada, inválida ou maior que 8 MB.');
 if(!url&&!media)throw Error('Inclua um link ou uma imagem.');
 const state=readEvidence();
 if((state.items||[]).length>=35)throw Error('Limite de 35 materiais por empresa.');
 const item={id:crypto.randomUUID(),kind,title,description,url,mediaId:media?.id||null,approved:false,createdAt:now()};
 // No automatic claim of client count, performance, testimonial authenticity or approval.
 state.items=[...(state.items||[]),item];setSetting(evidenceKey,state);return item;
}
export function approveSalesEvidence(id){
 const state=readEvidence(),item=(state.items||[]).find(x=>x.id===id);
 if(!item)throw Error('Material não encontrado.');
 item.approved=true;item.approvedAt=now();setSetting(evidenceKey,state);syncSalesProofs();return evidenceStatus();
}
export function approveAllSalesEvidence(){ const state=readEvidence();for(const item of state.items||[]){if(!item.approved){item.approved=true;item.approvedAt=now();}}setSetting(evidenceKey,state);return evidenceStatus();}
export function removeSalesEvidence(id){
 const state=readEvidence();state.items=(state.items||[]).filter(x=>x.id!==id);setSetting(evidenceKey,state);syncSalesProofs();return evidenceStatus();
}
export function approvedProofText(){
 return evidenceStatus().approved.map(x=>{
  const ref=x.url||(x.mediaId?'Imagem privada #'+x.mediaId:'');
  const link=x.mediaId?'[Arquivo privado cadastrado no painel; somente compartilhar via mídia autorizada]':ref;
  return '- '+x.kind+': '+x.title+' — '+x.description+' | '+link;
 }).join('\n').slice(0,6200);
}
function syncSalesProofs(){return saveSalesContextMarkdown('proofs','# Provas sociais e portfólio aprovados — empresa atual\n\n'+(approvedProofText()||'Nenhum material aprovado.'));}
const modes=['handoff','complete'];
const methods=['pix','card','transfer','invoice'];
export function salesClosingStatus(){
 const raw=getSetting(closeKey,null);
 const current=configuredClosing()||((process.env.PROSPECTOR_TENANT_INTERNAL==='true'||!process.env.PROSPECTOR_TENANT_ID)?{mode:'complete',methods:['pix'],depositPercent:50,pixKey:'',pixName:'',notifyOn:'receipt',configured:false}:null);
 return current?{mode:current.mode,methods:current.methods||[],depositPercent:current.depositPercent,
  pixConfigured:!!current.pixKey,pixMasked:current.pixKey?'••••'+current.pixKey.slice(-4):'',
  pixName:current.pixName||'',notifyOn:current.notifyOn||'interest',
  enabledForPayment:current.mode==='complete'&&current.methods?.includes('pix')&&!!current.pixKey,
  configured:!!raw}:null;
}
export function configuredClosing(){
 const raw=getSetting(closeKey,null);
 if(!raw||!modes.includes(raw.mode))return null;
 // Server-side Railway variables allow sensitive PIX details without committing
 // the CPF to GitHub or putting the full key into a client-facing API.
 // This fallback is ONLY for the trusted Consecom internal/root workspace.
 const isConsecom=process.env.PROSPECTOR_TENANT_INTERNAL==='true'||!process.env.PROSPECTOR_TENANT_ID;
 const allowManagedPix=isConsecom&&raw.mode==='complete'&&raw.methods?.includes('pix');
 const pixKey=allowManagedPix&&!raw.pixKey?String(process.env.CONSECOM_PIX_KEY||'').trim():raw.pixKey;
 const pixName=allowManagedPix&&!raw.pixName?String(process.env.CONSECOM_PIX_HOLDER||'').trim():raw.pixName;
 return {...raw,pixKey,pixName}; // backend only; public status exposes masked key
}
export function saveSalesClosingConfig(input={},base=null){
 const prev=base||getSetting(closeKey,{});
 const mode=clean(input.mode,30),depositPercent=Number(input.depositPercent??prev.depositPercent??0);
 if(!modes.includes(mode))throw Error('Escolha encaminhar ou fechar pelo atendimento.');
 if(!Number.isInteger(depositPercent)||depositPercent<0||depositPercent>100)throw Error('Entrada precisa estar entre 0% e 100%.');
 const requested=Array.isArray(input.methods)?input.methods:
  String(input.methods||'').split(',').map(x=>x.trim());
 const unique=[...new Set(requested.filter(x=>methods.includes(x)))];
 if(mode==='complete'&&unique.length===0)throw Error('Informe ao menos uma forma de pagamento.');
 const pixKey=input.pixKey===undefined?String(prev.pixKey||''):clean(input.pixKey,140);
 if(pixKey&&!/^[A-Za-z0-9@.+_-]{7,140}$/.test(pixKey))throw Error('Chave PIX inválida. Confira antes de salvar.');
 const config={mode,methods:mode==='handoff'?[]:unique,depositPercent:mode==='handoff'?0:depositPercent,
  pixKey:mode==='complete'&&unique.includes('pix')?pixKey:'',pixName:clean(input.pixName??prev.pixName,100),
  notifyOn:mode==='complete'?'receipt':'interest',at:now()};
 // A bare receipt is not payment confirmation. No automatic stage CLOSED_WON.
 setSetting(closeKey,config);saveSalesContextMarkdown('closing','# Política de fechamento — empresa atual\n\n'+customerPaymentGuidance());return salesClosingStatus();
}
export function customerPaymentGuidance(){
 const c=configuredClosing();
 if(!c)return 'Fechamento não configurado: encaminhe ao responsável.';
 if(c.mode==='handoff')return 'Modo de atendimento: qualifique e encaminhe ao responsável quando houver interesse. Não solicite pagamento.';
 return 'Modo de atendimento: pode conduzir até proposta e solicitar pagamento apenas com termos e valores aprovados; '+
  'formas aceitas: '+c.methods.join(', ')+'. Entrada: '+c.depositPercent+'%, saldo na entrega: '+(100-c.depositPercent)+'%. '+
  (c.methods.includes('pix')?(c.pixKey?'PIX configurado e disponível SOMENTE por resposta determinística do servidor após aceite explícito. '+(c.pixName?'Quando o cliente perguntar o titular do PIX, informe apenas o nome: '+c.pixName+'. ':''):'PIX ainda não configurado: não forneça chave nem solicite pagamento.'):'')+
  ' Registre o fechamento comercial quando o comprovante chegar e avise o dono para visualizar, sem exigir conferência bancária como etapa da negociação. Não declare que houve liquidação bancária.';
}
export function pixProposal({amountCents,service='serviço',fullPayment=false}={}){
 const cfg=configuredClosing();
 if(!cfg||cfg.mode!=='complete'||!cfg.methods.includes('pix')||!cfg.pixKey)return null;
 if(!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>500000000)return null;
 const percent=fullPayment?100:cfg.depositPercent;
 const entry=Math.round(amountCents*percent/100),remaining=amountCents-entry;
 if(entry<=0)return null;
 const money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const text='Para iniciar '+clean(service,100)+', '+(fullPayment?'o pagamento integral aprovado é de '+money(amountCents):'a condição aprovada é entrada de '+percent+'% ('+money(entry)+') e os '+(100-percent)+'% restantes ('+money(remaining)+') na entrega')+'. Valor total: '+money(amountCents)+
  '.\nPIX: '+cfg.pixKey+(cfg.pixName?'\nTitular: '+cfg.pixName:'')+
  '\nSe estiver de acordo, você pode realizar o pagamento combinado e enviar o comprovante por aqui. '+
  'Ao receber o comprovante, vou registrar o projeto e encaminhar as próximas orientações para começarmos.';
 return {text,entryCents:entry,remainingCents:remaining,amountCents};
}
