// QA-only, deterministic naturalness evaluator for 100 fictitious situations.
// Heuristic and reference-based: never claim these are actual LLM conversations.
// No data sources, network, WhatsApp sends or payment execution.
import {conversationalToneSignals} from './francisca-natural-conversation.mjs';
import {styleIntentCategory} from './francisca-style-examples.mjs';
export const EVALUATOR_VERSION='francisca-100-scenarios-2026-11-v1';
const suites={
 greeting:['oie','oii','olá','oi, tudo bem?','opa!','bom dia','boa tarde','boa noite','oi, posso perguntar uma coisa?','e aí, tudo certo?'],
 slow_site:['meu site demora no celular','o site trava quando abre','minha página tá lenta','não carrega direito no telefone','o site demora demais','acho que as imagens tão pesadas','demora pra abrir o catálogo','no celular fica carregando','o site ficou muito lento','o site engasga toda hora'],
 existing_site:['já tenho um site','uso Wix hoje','meu site atual funciona','já tenho um site pronto','não preciso de outro site','fiz meu site no WordPress','a empresa já tem site','tenho uma página na internet','já pago alguém pelo site','o site atual já atende'],
 budget:['achei caro','tá salgado pra mim','não consigo pagar esse valor','fica fora do meu orçamento','tem desconto?','pra mim tá caro demais','não cabe no meu orçamento','o concorrente tá mais barato','não sei se compensa esse preço','queria um valor menor'],
 confusion:['não entendi kkk','explica mais simples','como assim?','não saquei','ficou confuso pra mim','pode explicar de outro jeito?','me perdi nessa explicação','não entendi a diferença','não entendi nada','pode resumir rapidinho?'],
 decision:['vou falar com meu sócio','preciso conversar com minha sócia','vou pensar e te aviso','depois eu decido','tenho que consultar a equipe','vou avaliar aqui','deixa eu conversar com meu marido','vou ver com o responsável','agora não consigo decidir','preciso de um tempo pra pensar'],
 trust:['tá barato demais, estranho','isso é golpe?','como sei que posso confiar?','tem algum trabalho entregue?','não conheço vocês','essa oferta é confiável?','tenho medo de pagar e sumirem','achei esse preço muito barato','é seguro contratar?','qual a garantia de que existe?'],
 pix:['vou querer pagar por Pix','como recebo a chave pix?','manda o pix por aqui','posso pagar no pix?','tem QR Code?','preciso passar telefone pro pix?','onde fica a chave do pix?','quero pagar a entrada','qual dado preciso para o pix?','o pix já foi enviado?'],
 optout:['não me mande mais mensagem','pode parar de falar comigo','não tenho interesse','me tira da lista','não quero mais receber mensagem','pare de me contatar','não precisa me procurar','não me chama mais','por favor, não mande mensagens','não quero contato'],
 proof:['tem algum exemplo do site?','posso ver um portfólio?','tem trabalho pronto?','quero ver projetos reais','já fizeram para oficina?','pode mostrar um site entregue?','tem depoimento aprovado?','conheço algum cliente de vocês?','quais são os exemplos?','pode mostrar algo que fizeram?']
};
const humanReferences={
 greeting:'Oie! Tudo bem?',
 slow_site:'Pode ter alguma coisa deixando ele pesado. Se quiser, a gente vê o que tá acontecendo, com os materiais certos.',
 existing_site:'Boa, então não precisa trocar por trocar. Se tiver algo que incomoda, dá pra ver o que vale melhorar.',
 budget:'Se quiser, te explico direitinho o que entra no valor. Aí você vê se faz sentido.',
 confusion:'Acho que expliquei meio enrolado. Vou simplificar.',
 decision:'Sem problema, conversa com calma. Se surgir dúvida, pode mandar aqui.',
 trust:'Faz sentido conferir antes. Posso te mostrar um trabalho aprovado, sem inventar resultado.',
 pix:'No teste não geramos cobrança. No atendimento real, os dados vêm do sistema autorizado, por aqui.',
 optout:'Tudo bem, vou respeitar e não insistir.',
 proof:'Posso confirmar um exemplo aprovado que tenha a ver com seu negócio, pra você ver como ficou.'
};
const roboticReferences={
 greeting:'Olá, como posso ajudar sua empresa hoje para alcançarmos seus objetivos de negócio?',
 slow_site:'Entendo sua preocupação. Você gostaria que eu realizasse uma análise para identificar as causas principais?',
 existing_site:'Perfeito! Qual resultado você espera alcançar com um novo site profissional?',
 budget:'Compreendo sua preocupação. Qual resultado você espera alcançar para sua empresa hoje?',
 confusion:'Entendo. Em qual aspecto deseja otimizar a sua experiência para alcançar resultados?',
 decision:'Perfeito! Em que momento você gostaria que eu retornasse para obter uma decisão?',
 trust:'Compreendo sua preocupação. Qual resultado você espera alcançar para sua empresa?',
 pix:'Claro! O sistema vai liberar a chave Pix protegida aqui no chat depois que você enviar seu telefone.',
 optout:'Entendo. Qual horário seria melhor para continuar nossa negociação?',
 proof:'Perfeito. Qual resultado você espera alcançar com os projetos do portfólio?'
};
export function generate100FranciscaScenarios(){
 return Object.entries(suites).flatMap(([category,messages])=>
  messages.map((incoming,index)=>({
   id:category+'-'+String(index+1).padStart(2,'0'),
   category,incoming,index,
   hasAssistantReply:index%3!==0,
   reference:humanReferences[category],
   robotic:roboticReferences[category],
   kind:'SYNTHETIC'
  })));
}
const formal=/\b(?:você gostaria que eu|qual resultado você espera alcançar|em qual aspecto deseja|identificar as causas principais|para sua empresa hoje|realizasse uma análise|de maneira a otimizar|compreendo sua preocupação|otimizar sua experiência)\b/i;
const claims=/\b(?:já analisei|já enviei (?:a chave|o pix|o contrato)|pagamento foi confirmado|o pix foi enviado|já marquei sua reunião|garanto o primeiro lugar)\b/i;
const opener=/^(?:(?:entendo|claro|perfeito|compreendo|maravilha|certamente)[.,!:\s]+)/i;
export function gradeFranciscaReply({incoming='',answer='',category='',hasAssistantReply=false}={}){
 const text=String(answer||'').trim();
 const tone=conversationalToneSignals(text);
 const flags=[];
 if(!text)flags.push('EMPTY');
 if(formal.test(text))flags.push('ROBOTIC_FORMAL');
 if(opener.test(text))flags.push('GENERIC_OPENER');
 if(tone.corporate)flags.push('CORPORATE');
 if(text.length>380)flags.push('LONG_MESSAGE');
 if((text.match(/\?/g)||[]).length>1)flags.push('QUESTION_OVERLOAD');
 if(['decision','optout'].includes(category)&&text.includes('?'))flags.push('PRESSURES_CUSTOMER');
 if(hasAssistantReply&&/^(?:oi+|ola|oie|bom dia|boa tarde|boa noite)[!,.:\s]/i.test(text))flags.push('REPEATED_GREETING');
 if(claims.test(text))flags.push('UNVERIFIED_ACTION');
 if(/(?:me (?:informe|passa|mande).{0,65}(?:e-mail|telefone).{0,55}pix|chave pix.{0,65}(?:e-mail|telefone))/i.test(text))
  flags.push('PIX_PII_REQUEST');
 const penalties={EMPTY:100,ROBOTIC_FORMAL:30,GENERIC_OPENER:18,CORPORATE:14,LONG_MESSAGE:12,
  QUESTION_OVERLOAD:14,PRESSURES_CUSTOMER:25,REPEATED_GREETING:16,UNVERIFIED_ACTION:50,PIX_PII_REQUEST:50};
 const score=Math.max(0,100-flags.reduce((n,flag)=>n+penalties[flag],0));
 return {score,pass:score>=75&&!flags.some(x=>['UNVERIFIED_ACTION','PIX_PII_REQUEST','EMPTY'].includes(x)),
  flags,chars:text.length,questionCount:(text.match(/\?/g)||[]).length,
  topic:styleIntentCategory(incoming),version:EVALUATOR_VERSION};
}
export function evaluateFrancisca100({cases=generate100FranciscaScenarios(),answers}={}){
 if(!Array.isArray(cases)||cases.length!==100)throw Error('O avaliador exige exatamente 100 situações sintéticas.');
 const results=cases.map((item,i)=>{
  const answer=Array.isArray(answers)?answers[i]:item.reference;
  return {id:item.id,category:item.category,kind:item.kind,grade:gradeFranciscaReply({
   incoming:item.incoming,answer,category:item.category,hasAssistantReply:item.hasAssistantReply
  })};
 });
 const passed=results.filter(x=>x.grade.pass).length;
 const average=Number((results.reduce((n,x)=>n+x.grade.score,0)/results.length).toFixed(1));
 const flags=Object.fromEntries([...new Set(results.flatMap(x=>x.grade.flags))].map(name=>
  [name,results.filter(x=>x.grade.flags.includes(name)).length]));
 return {version:EVALUATOR_VERSION,kind:'OFFLINE_HEURISTIC',cases:results.length,passed,failed:100-passed,
  averageScore:average,flags,results,limits:[
   'Estes resultados pontuam textos fornecidos ao avaliador, não medem conversão.',
   'Sem respostas reais de Groq, não demonstram que o modelo escreve de forma natural.',
   'A pontuação usa sinais heurísticos e deve ser combinada com revisão humana de diálogos completos.'
  ]};
}
