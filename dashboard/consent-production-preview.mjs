// Read-only preview calculated from REAL production leads.
// Disabling consent in this preview never disables WhatsApp send-time opt-in checks.
import {one} from './db.mjs';
import {outreachQueueSnapshot} from './outreach-queue.mjs';
import {coldOutreachSwitchEnabled} from './cold-outreach-switch.mjs';

export const CONSENT_PREVIEW_VARIABLE='PROSPECTOR_CONSENT_PREVIEW_REQUIRED';
export const consentRequiredInPreview=()=>process.env.PROSPECTOR_CONSENT_PREVIEW_REQUIRED!=='false';

export function previewConsentCounts(queue,{required=consentRequiredInPreview()}={}){
 const total=Math.max(0,Number(queue?.total)||0);
 const withoutConsent=Math.max(0,total-(Number(queue?.missingWhatsapp)||0)-(Number(queue?.suppressed)||0));
 const withConsent=Math.max(0,Number(queue?.ready)||0);
 return {
  productionData:true,previewOnly:true,actualWhatsAppConsentChecksAlwaysOn:true,
  consentRequiredInPreview:required,engineEnabled:coldOutreachSwitchEnabled(),
  total,readyWithConsent:withConsent,readyWithoutConsentPreview:withoutConsent,
  visibleReady:required?withConsent:withoutConsent,
  waitingForConsent:Math.max(0,Number(queue?.awaitingConsent)||0)
 };
}

export function productionConsentPreview(){
 const queue=outreachQueueSnapshot(),counts=previewConsentCounts(queue);
 const sample=queue.recent.slice(0,12).map(item=>{
  const info=one('SELECT business,city FROM leads WHERE id=?',item.id);
  const eligibleWithoutConsent=item.status!=='NO_WHATSAPP'&&item.status!=='SUPPRESSED';
  return {
   business:String(info?.business||'Empresa').slice(0,90),
   city:String(info?.city||'').slice(0,70),
   previewStatus:counts.consentRequiredInPreview
     ?(item.status==='READY'?'Pronto':'Aguardando autorização')
     :(eligibleWithoutConsent?'Pronto na prévia':'Não elegível'),
   realStatus:item.status
  };
 });
 return {...counts,sample,warning:'Prévia com leads reais de produção. Não remove autorização para o envio real.',
  variables:{engine:'PROSPECTOR_COLD_FIRST_APPROACH',consentPreview:CONSENT_PREVIEW_VARIABLE}};
}

const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function consentPreviewHtml(state=productionConsentPreview()){
 const rows=state.sample.map(x=>'<tr><td>'+escapeHTML(x.business)+'</td><td>'+escapeHTML(x.city)+'</td><td>'+escapeHTML(x.previewStatus)+'</td></tr>').join('');
 const style='body{background:#101114;color:#f6f6f7;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:clamp(18px,5vw,54px)}main{max-width:1000px;margin:auto}.eyebrow{font-size:12px;letter-spacing:.15em;color:#ff914d}h1{font-size:clamp(26px,4vw,43px);letter-spacing:-.035em}.muted{color:#b3b3b8;line-height:1.65}.tag{display:inline-block;border:1px solid #875034;border-radius:100px;padding:8px 13px;color:#ffd0b4;font-size:13px;font-weight:600}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:27px 0}.stat{border:1px solid #343539;background:#1a1b1f;border-radius:17px;padding:24px}.stat strong{font-size:39px;display:block;margin-bottom:9px}.stat span{font-size:13px;color:#c7c7cb}.accent{color:#ff914d}table{border-collapse:collapse;width:100%;background:#1a1b1f;border:1px solid #343539;border-radius:16px;overflow:hidden}th,td{padding:15px;text-align:left;border-bottom:1px solid #313236;font-size:14px}th{color:#bcbcc2;font-weight:500}tr:last-child td{border:0}.notice{border-left:3px solid #ff914d;padding:10px 17px;margin:25px 0;color:#e6d4c9;background:#231d19}code{color:#ffb286;word-break:break-all}footer{font-size:13px;color:#a8a8ae;padding-top:25px}';
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consecom | Prévia de consentimento</title><style>'+style+'</style></head><body><main>'
 +'<div class="eyebrow">PROSPECTOR / CONSECOM BRASIL</div><h1>Consentimento — produção</h1>'
 +'<p class="muted">Dados reais de produção. Compare os leads com e sem o filtro de autorização nesta prévia. Nenhum disparo é liberado.</p>'
 +'<span class="tag">Prévia: '+(state.consentRequiredInPreview?'FILTRO DE CONSENTIMENTO LIGADO':'FILTRO DE CONSENTIMENTO DESLIGADO')+'</span>'
 +'<div class="stats"><div class="stat"><strong>'+state.total+'</strong><span>Leads na fila de produção</span></div>'
 +'<div class="stat"><strong>'+state.readyWithConsent+'</strong><span>Com autorização registrada</span></div>'
 +'<div class="stat"><strong class="accent">'+state.readyWithoutConsentPreview+'</strong><span>Potencial sem filtro (simulado)</span></div>'
 +'<div class="stat"><strong>'+state.visibleReady+'</strong><span>Prontos somente na prévia</span></div></div>'
 +'<div class="notice">Esta variável não altera as autorizações reais. O WhatsApp continua exigindo consentimento para qualquer envio efetivo.</div>'
 +'<h2>Amostra da fila real</h2><table><thead><tr><th>Empresa</th><th>Cidade</th><th>Status na prévia</th></tr></thead><tbody>'+rows+'</tbody></table>'
 +'<footer><p>Motor: <code>PROSPECTOR_COLD_FIRST_APPROACH</code> · Filtro da prévia: <code>'+escapeHTML(CONSENT_PREVIEW_VARIABLE)+'</code></p>'
 +'<p>Modifique a variável no Railway e recarregue esta página após o deploy.</p></footer></main></body></html>';
}
