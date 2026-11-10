// Consecom portfolio pitch: synthesize the CURRENT, approved offer.
// The previous private owner recording explicitly quotes R$350. Never silently
// send it in an R$550 conversation. A human can replace that recording later.
import {makeFranciscaVoice} from './francisca-tts.mjs';
import {PORTFOLIO_PRICE_BRL} from './portfolio-offer-550.mjs';

export const CURRENT_VOICE_OFFER_BRL=PORTFOLIO_PRICE_BRL;
export const CURRENT_VOICE_PITCH_TEXT=
  'Oi! Aqui é a Francisca, da Consecom. Vou explicar a proposta que o Wesley comentou. '+
  'Estamos selecionando algumas empresas para criar sites profissionais e mostrar esses projetos no nosso portfólio. '+
  'Para vocês, a proposta é um site por R$ 550, com domínio pago por um ano. '+
  'O site apresenta os serviços, passa mais credibilidade e facilita o contato pelo WhatsApp. '+
  'O prazo é de até três dias úteis, contando da confirmação da entrada e do recebimento dos materiais. '+
  'Posso te mostrar alguns exemplos dos sites que a gente já fez.';

export function currentVoiceEligible(){
 return !process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
}
export async function loadCurrentPortfolioVoice({synthesize=makeFranciscaVoice}={}){
 if(!currentVoiceEligible())throw Error('CONSECOM_VOICE_WRONG_TENANT');
 if(process.env.FRANCISCA_TTS_ENABLED!=='true')throw Error('CONSECOM_VOICE_550_TTS_UNAVAILABLE');
 const audio=await synthesize(CURRENT_VOICE_PITCH_TEXT);
 if(!Buffer.isBuffer(audio?.bytes)||audio.bytes.length<256)throw Error('CONSECOM_VOICE_550_BAD_OUTPUT');
 return {bytes:audio.bytes,offerBRL:CURRENT_VOICE_OFFER_BRL,source:'FRANCISCA_TTS',durationSeconds:null};
}
