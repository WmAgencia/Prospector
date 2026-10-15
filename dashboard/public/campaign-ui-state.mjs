// Shared, side-effect-free UI state for campaign cards and dashboard.
export function campaignStatus({workflow,activeId,settings={},connection={}}){
 if(!workflow)return {state:'none',label:'Nenhuma campanha selecionada',running:false,active:false,canActivate:false};
 const active=workflow.id===activeId&&Boolean(workflow.enabled);
 const steps=Array.isArray(workflow.steps)?workflow.steps:[];
 const attached=steps.some(x=>x.type==='audio'&&x.media_id)&&steps.some(x=>x.type==='video'&&x.media_id);
 if(active){
  if(settings.paused)return {state:'paused',label:'Selecionada · operação pausada',running:false,active:true,canActivate:false};
  if(connection.status!=='CONNECTED')return {state:'disconnected',label:'Selecionada · aguardando WhatsApp',running:false,active:true,canActivate:false};
  if(settings.auto_initial===false)return {state:'standby',label:'Selecionada · início automático desativado',running:false,active:true,canActivate:false};
  return {state:'running',label:'Campanha em operação',running:true,active:true,canActivate:false};
 }
 return {state:attached?'ready':'draft',label:attached?'Pronta para selecionar':'Rascunho · faltam mídias',running:false,active:false,canActivate:Boolean(attached)};
}
export function campaignPreview(steps=[]){
 const s=Array.isArray(steps)?steps:[];
 const before=s.find(x=>x.type==='delay')?.seconds??0;
 const after=s.filter(x=>x.type==='delay')[1]?.seconds??0;
 const audio=s.find(x=>x.type==='audio');
 const video=s.find(x=>x.type==='video');
 const decision=s.find(x=>x.type==='decision');
 return {
  initial:s.find(x=>x.type==='message')?.text||'',
  waitBeforeAudio:Number(before),
  waitBeforeVideo:Number(after),
  hasAudio:!!audio?.media_id,
  hasVideo:!!video?.media_id,
  caption:video?.caption||'',
  farewell:decision?.no_text||'',
  handover:decision?.yes_action==='handover',
  steps:s.length
 };
}
