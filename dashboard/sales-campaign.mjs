// Offer must be true, time bounded and contain real owner media.
import {one,run,audit} from './db.mjs';
import {saveWorkflow,setDefaultWorkflow} from './runtime.mjs';
import {validateExpiry,proposedFlow} from './campaign-rules.mjs';
export function setSalesCampaign(input){
 const audio=one("SELECT id FROM media WHERE id=? AND kind='audio'",input.audio_id||'');
 const video=one("SELECT id FROM media WHERE id=? AND kind='video'",input.video_id||'');
 if(!audio||!video)throw Error('Envie áudio e vídeo reais antes de ativar a campanha');
 const ends=validateExpiry(input.expires_on);
 if(Number(input.price)!==350)throw Error('Oferta configurada para R$350');
 if(input.confirm_offer!==true)throw Error('Confirme que preço, prazo e validade são reais');
 const old=one("SELECT id FROM workflows WHERE name='Oferta Consecom R$350 · Resposta → Áudio → Vídeo' LIMIT 1");
 const steps=proposedFlow({audioId:audio.id,videoId:video.id,intro:input.intro});
 const workflowId=saveWorkflow({id:old?.id,name:'Oferta Consecom R$350 · Resposta → Áudio → Vídeo',enabled:true,segments:[],steps});
 setDefaultWorkflow(workflowId);
 run("INSERT INTO settings(key,value) VALUES('campaign_offer_expiry',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(ends));
 audit('PROMOTION_CONFIGURED',null,{workflowId,expiresOn:ends,price:350});
 return {workflowId,expiresOn:ends,configured:true,pausedForReview:true};
}
