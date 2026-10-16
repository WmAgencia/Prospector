// Fonte única do roteiro Consecom R$350. Apenas configuração, sem enviar mensagens.
import crypto from 'node:crypto';

export const CAMPAIGN_NAME='Consecom | Site profissional R$ 350 | Áudio + vídeo';
export const CAMPAIGN_INTRO='{{greeting}} Eu sou da agência Consecom. Demos uma olhada no seu perfil e gostaríamos de te apresentar uma proposta. Posso te enviar um áudio com os detalhes?';
export const CAMPAIGN_VIDEO_CAPTION='O que achou? Gostaria de ter um assim também?';
export const CAMPAIGN_FAREWELL='Sem problemas, muito obrigado pelo retorno, ficamos à disposição.';
export const CAMPAIGN_AUDIO_DESCRIPTION='Áudio original gravado pelo Wesley, da Consecom. Apresenta a agência de sites em Sorocaba, seleção de empresas, proposta de site completo por R$ 350 com 80% de desconto, portfólio mediante permissão e entrega em até três dias; pede para ver vídeo e informar se tem interesse.';

export function buildConsecomSteps({audioId='',videoId='',existingSteps=[]}={}){
 const old=Array.isArray(existingSteps)?existingSteps:[];
 const pick=(type,i=0)=>old.filter(x=>x.type===type)[i]||{};
 const step=(type,i=0,fields={})=>({...pick(type,i),id:pick(type,i).id||crypto.randomUUID(),type,...fields});
 const sound=pick('audio',0),video=pick('video',0),decision=pick('decision',0);
 return [
  step('message',0,{text:CAMPAIGN_INTRO}),
  step('wait_reply',0),
  step('delay',0,{seconds:45}),
  step('audio',0,{media_id:audioId||sound.media_id||'',description:sound.description||CAMPAIGN_AUDIO_DESCRIPTION}),
  step('delay',1,{seconds:10}),
  step('video',0,{media_id:videoId||video.media_id||'',caption:CAMPAIGN_VIDEO_CAPTION}),
  step('wait_reply',1),
  step('decision',0,{
   context:'website_interest',
   context_description:'Depois do vídeo com a pergunta "O que achou? Gostaria de ter um assim também?", o cliente confirma se quer um site.',
   yes_type:'message',yes_text:'',yes_action:'handover',
   no_type:'message',no_text:CAMPAIGN_FAREWELL,no_action:'end'
  }),
  step('end',0)
 ];
}
