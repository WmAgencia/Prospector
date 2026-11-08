// Reviewed examples of everyday Brazilian WhatsApp phrasing, never raw-chat mining.
// Inspired by retrieving "they said -> approved reply" pairs. No Selenium,
// external vector DB, or runtime messages sent by this module.
// Tenant-local SQLite. Only synthetic or manually consented/anonymized samples.
import {db,all,one,run,id,now} from './db.mjs';
export const STYLE_MEMORY_VERSION='francisca-style-memory-2026-11-v1';
export const STYLE_MEMORY_FLAG='FRANCISCA_STYLE_EXAMPLES_V1_ENABLED';
export const styleMemoryEnabled=(env=process.env)=>env[STYLE_MEMORY_FLAG]==='true'&&
 (!env.PROSPECTOR_TENANT_ID||env.PROSPECTOR_TENANT_INTERNAL==='true');
const seeded=Object.freeze([
 ['oie','Oie! Tudo bem?'],
 ['Como funciona isso?','É simples. Me fala qual parte você quer entender que eu explico por aqui.'],
 ['Acho que não entendi muito bem','Acho que expliquei meio enrolado. Vou simplificar.'],
 ['Já tenho um site','Boa. Se ele já atende bem, não tem por que trocar. Tem algo nele que você quer melhorar?'],
 ['Meu site está muito lento no celular','Pode ter alguma coisa deixando ele pesado. Se quiser, posso dar uma olhada no código pra tentar entender onde tá o problema.'],
 ['Nossa, achei caro','Se quiser, te explico direitinho o que entra no valor. Aí você vê se faz sentido pra você.'],
 ['Tá barato demais, tô desconfiado','Faz sentido desconfiar. Melhor olhar trabalhos entregues e entender direitinho o que está incluso.'],
 ['Você tem algum exemplo para ver?','Vou conferir qual projeto aprovado combina com seu ramo, pra não te mandar qualquer coisa.'],
 ['Quero ver com meu sócio antes','Sem problema, conversa com ele com calma. Se surgir alguma dúvida, pode mandar aqui.'],
 ['Tô atendendo cliente agora','Tranquilo, não vou te prender. Deixo as informações aqui pra você ler quando puder.'],
 ['Queria entender a diferença entre as opções','A diferença está no que você precisa que o site faça. Me conta só essa parte pra comparar.'],
 ['Queria mais clientes pelo WhatsApp','O contato precisa ficar visível. Só ter site não garante clientes, mas facilita que falem com você.'],
 ['Vocês conseguem melhorar minhas fotos?','Dá pra trabalhar com as fotos que você já tem. A gente vê se vale tratar ou criar uma ilustração de apoio.'],
 ['Me fala o valor de novo','Posso lembrar as condições. Antes, vou conferir a proposta aprovada pra não te passar nada errado.'],
 ['Quero fechar, como seguimos?','Legal. A gente organiza os próximos passos, confirmando as condições antes de qualquer cobrança.'],
 ['Como recebo os dados do Pix?','Os dados vêm do sistema de pagamento quando a cobrança estiver autorizada. Não precisa outro telefone só pra isso.'],
 ['Eu posso pagar no cartão?','Vamos conferir as formas disponíveis na proposta. Não vou prometer uma opção que ainda não está habilitada.'],
 ['Pode enviar por aqui mesmo','Pode ser por aqui. Só vou conferir o que ficou combinado antes.'],
 ['Não quero mais receber mensagens','Tudo bem. Vou respeitar sua decisão e não insistir.'],
 ['Você é uma pessoa ou uma inteligência artificial?','Sou a Francisca, assistente virtual da equipe. Posso ajudar e encaminhar pro responsável se precisar.'],
 ['Me explica esse SEO','É a preparação do site para facilitar a leitura pelos buscadores, sem prometer uma posição específica no Google.'],
 ['Sou de uma oficina, preciso mostrar os serviços','Dá pra organizar os serviços de um jeito fácil de visualizar e com contato bem claro.'],
 ['kkkk eu não entendi nada','Foi mal, expliquei complicado 😅 Me diz qual parte ficou confusa que eu simplifico.'],
 ['Tenho pressa mas não tenho as fotos ainda','Dá pra organizar os materiais e ver o que falta. A data de entrega preciso confirmar certinho.'],
 ['oi, posso perguntar uma coisa?','Pode sim, manda.'],
 ['bom dia','Bom dia! Tudo bem?'],
 ['meu site demora no celular','Poxa, isso incomoda mesmo. Se tiver os arquivos, dá pra conferir o que pode estar pesando.'],
 ['o site trava quando abre','Pode ser alguma coisa no carregamento. Melhor entender isso antes de pensar em refazer.'],
 ['minha página tá lenta','Entendi. Se tiver mais detalhes do problema, dá pra investigar melhor.'],
 ['uso Wix hoje','Ah, legal. Se o site funciona bem, não tem por que fazer outro só por fazer.'],
 ['já tenho um site pronto','Boa! Então vamos ver se tem alguma coisa que ainda falta melhorar nele.'],
 ['não preciso de outro site','Tudo bem. Se o atual já resolve, não faz sentido insistir em outro.'],
 ['tem desconto?','Essa condição eu preciso conferir. Posso te explicar o que já está incluído.'],
 ['fica fora do meu orçamento','Entendi. A gente pode olhar as condições aprovadas, sem inventar desconto.'],
 ['não sei se compensa esse preço','Faz sentido querer entender o valor. Posso explicar o que está incluído pra você avaliar.'],
 ['não saquei','Foi mal, acho que compliquei. Vou explicar mais simples.'],
 ['pode explicar de outro jeito?','Dá sim. Vou falar de outro jeito, sem enrolar.'],
 ['como assim?','Acho que não expliquei direito. Vou simplificar.'],
 ['vou pensar e te aviso','Beleza, pode pensar com calma. Se pintar dúvida, me chama aqui.'],
 ['preciso consultar a equipe','Tranquilo. Conversa com o pessoal e, se precisarem de mais alguma informação, me fala.'],
 ['depois eu decido','Sem pressa. Pode olhar com calma.'],
 ['como sei que posso confiar?','É bom conferir mesmo. Dá pra olhar os projetos que foram aprovados para divulgação.'],
 ['é seguro contratar?','Entendo a dúvida. Podemos esclarecer as condições e mostrar referências aprovadas, sem pressa.'],
 ['isso é golpe?','É certo conferir antes. A equipe pode mostrar os trabalhos aprovados e explicar como funciona.'],
 ['posso pagar no pix?','Se esse pagamento estiver disponível e autorizado, os dados são enviados aqui mesmo pela cobrança do sistema.'],
 ['onde fica a chave do pix?','Os dados vêm do sistema quando a cobrança é autorizada. Não precisa passar outro número pra isso.'],
 ['preciso passar telefone pro pix?','Não precisa de outro telefone para gerar a chave. O envio depende da cobrança autorizada.'],
 ['me tira da lista','Tudo bem, vamos respeitar seu pedido. Não vou insistir.'],
 ['não quero contato','Pode deixar, respeito sua decisão.'],
 ['pare de me contatar','Entendido, não vou insistir em contato.'],
 ['tem algum exemplo do site?','Posso confirmar uma referência aprovada que combine com o seu negócio.'],
 ['quero ver projetos reais','Dá pra mostrar os trabalhos que a equipe autorizou divulgar.'],
 ['pode mostrar um site entregue?','A gente confere um projeto aprovado e te mostra por aqui.']
]);
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const privatePatterns=[
 /(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]*\d{4}/,
 /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,/(?:https?:\/\/|www\.|wa\.me\/)/i,
 /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,/\b(?:\d[ -]?){13,19}\b/,
 /\b(?:pix\s*(?:chave|key)|chave\s*pix)\s*[:=-]\s*\S+/i,
 /\b(?:senha|password|token|secret|api[\s_-]?key)\s*[:=-]\s*\S+/i,
 /\b(?:r\$\s*\d+|\d+(?:[,.]\d+)?\s*reais)\b/i
];
export function validateStylePair({incoming='',reply=''}={}){
 const a=String(incoming||'').trim(),b=String(reply||'').trim();
 if(a.length<3||a.length>230||b.length<5||b.length>330)
  throw new Error('Use pergunta de 3–230 caracteres e resposta de 5–330 caracteres.');
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(a+b)||privatePatterns.some(re=>re.test(a)||re.test(b)))
  throw new Error('Remova telefones, e-mails, links, valores, chaves e dados pessoais.');
 if(/\b(?:ja enviei|já enviei|pagamento (?:foi |est[aá] )?confirmado|pix enviado|reuniao marcada|reunião marcada)\b/i.test(b))
  throw new Error('O exemplo não pode afirmar ações ainda não confirmadas.');
 return {incoming:a,reply:b};
}
db.exec("CREATE TABLE IF NOT EXISTS francisca_style_examples(id TEXT PRIMARY KEY,incoming TEXT NOT NULL,reply TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('SYNTHETIC','CONSENTED_ANONYMIZED')),status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED')),created_at TEXT NOT NULL,approved_at TEXT)");
export function styleExampleStatus(){
 if(!styleMemoryEnabled())return {enabled:false,version:STYLE_MEMORY_VERSION,seeded:0,approved:0,pending:0,items:[]};
 const rows=all('SELECT id,incoming,reply,source,status,created_at,approved_at FROM francisca_style_examples ORDER BY created_at DESC LIMIT 100');
 return {enabled:true,version:STYLE_MEMORY_VERSION,seeded:seeded.length,
  approved:rows.filter(x=>x.status==='APPROVED').length,pending:rows.filter(x=>x.status==='PENDING').length,items:rows};
}
export function proposeStyleExample({incoming='',reply='',source='',permissionConfirmed=false}={}){
 if(!styleMemoryEnabled())throw new Error('Biblioteca de estilo indisponível.');
 if(!['SYNTHETIC','CONSENTED_ANONYMIZED'].includes(source)||permissionConfirmed!==true)
  throw new Error('Confirme origem, autorização e anonimização.');
 const pair=validateStylePair({incoming,reply});
 const existing=one('SELECT id FROM francisca_style_examples WHERE incoming=? AND reply=?',pair.incoming,pair.reply);
 if(existing)return {ok:true,created:false,id:existing.id};
 const key=id();
 run('INSERT INTO francisca_style_examples(id,incoming,reply,source,status,created_at) VALUES(?,?,?,?,?,?)',key,pair.incoming,pair.reply,source,'PENDING',now());
 return {ok:true,created:true,id:key};
}
export function reviewStyleExample({id:exampleId,action}={}){
 if(!styleMemoryEnabled())throw new Error('Biblioteca de estilo indisponível.');
 if(!['APPROVE','DELETE'].includes(action))throw new Error('Ação inválida.');
 const row=one('SELECT id,status FROM francisca_style_examples WHERE id=?',String(exampleId||''));
 if(!row)throw new Error('Exemplo não encontrado.');
 if(action==='DELETE')run('DELETE FROM francisca_style_examples WHERE id=?',row.id);
 else run("UPDATE francisca_style_examples SET status='APPROVED',approved_at=? WHERE id=? AND status='PENDING'",now(),row.id);
 return {ok:true};
}
// Category compatibility prevents lexical overlap from cross-pollinating
// unrelated customer intents (e.g. "não entendi" vs "não me contate").
export function styleIntentCategory(text=''){
 const t=norm(text);
 if(/^(?:oi+|oie+|ola+|opa|bom dia|boa tarde|boa noite)[!?.\s]*$/.test(t))return 'greeting';
 if(/\b(?:nao quero mais receber|pare de mandar|nao me mande|sem interesse|remova meu numero|parar de falar|me tira da lista|nao quero contato|nao me chama|pare de me contatar|nao precisa me procurar)\b/.test(t))return 'optout';
 if(/\b(?:nao entendi|nao compreendi|confuso|explica mais simples|entendi nada|falar mais simples|nao saquei|explicar de outro jeito|me perdi|como assim|pode resumir)\b/.test(t))return 'confusion';
 if(/\b(?:barato demais|muito barato|desconfi|golpe|confiavel|confiar|seguro contratar|nao conheco voces|medo de pagar)\b/.test(t))return 'trust';
 if(/\b(?:caro|desconto|fora do orcamento|valor alto|compensa pagar)\b/.test(t))return 'budget';
 if(/\b(?:site|pagina|carregamento|celular|telefone|catalogo)\b/.test(t)&&/\b(?:lento|lentidao|demora|travando|trava|pesado|carrega|abrir)\b/.test(t))return 'slow_site';
 if(/\b(?:socio|socia|vou pensar|consultar|responsavel|vou avaliar)\b/.test(t))return 'decision';
 if(/\b(?:ocupad|atendendo|sem tempo|correria)\b/.test(t))return 'busy';
 if(/\b(?:chave pix|pix|qr code)\b/.test(t))return 'pix';
 if(/\b(?:cartao|parcel|credito)\b/.test(t))return 'card';
 if(/\b(?:sou humano|voce e uma pessoa|voce e um robo|inteligencia artificial)\b/.test(t))return 'identity';
 if(/\b(?:quero fechar|quero contratar|quero comprar|pode iniciar)\b/.test(t))return 'closing';
 if(/\b(?:portfolio|exemplo|trabalho|projeto|depoimento|site entregue|site que voces fizeram|pode mostrar|quero ver projetos)\b/.test(t))return 'proof';
 if(/\b(?:seo|google)\b/.test(t))return 'seo';
 if(/\b(?:site|wix|wordpress)\b/.test(t)&&/\b(?:tenho|ja existe|atual|uso)\b/.test(t))return 'existing_site';
 if(/\b(?:oficina|mecanica|servicos|catalogo|produtos)\b/.test(t))return 'showcase';
 if(/\b(?:valor|preco|quanto custa|quanto fica)\b/.test(t))return 'price';
 return 'other';
}
const stop=new Set(['a','as','o','os','e','de','da','do','das','dos','um','uma','pra','para','por','no','na','nos','nas','que','eu','voce','voces','vcs','vc','me','te','se','isso','aqui','esse','essa','este','esta','meu','minha','com','tem','ser','vai','como','mas','ja','so','to','ta','entao','nao','mais','nada']);
const words=x=>norm(x).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>=2&&!stop.has(x));
const grams=x=>{const n=norm(x).replace(/[^a-z0-9]/g,'');const g=new Set();for(let i=0;i<n.length-2;i++)g.add(n.slice(i,i+3));return g;};
const jaccard=(a,b)=>{if(!a.size||!b.size)return 0;let intersection=0;for(const x of a)if(b.has(x))intersection++;return intersection/(a.size+b.size-intersection);};
export function findStyleExamples({incoming='',limit=3}={}){
 if(!styleMemoryEnabled()||!String(incoming||'').trim())return [];
 const external=all("SELECT id,incoming,reply,source FROM francisca_style_examples WHERE status='APPROVED' ORDER BY approved_at DESC LIMIT 100");
 const corpus=[...seeded.map(([incoming,reply],i)=>({id:'built-in-'+i,incoming,reply,source:'SYNTHETIC_BUILTIN'})),...external];
 const query=new Set(words(incoming));if(!query.size)return [];
 const topic=styleIntentCategory(incoming);
 const documents=corpus.map(x=>new Set(words(x.incoming)));
 const frequency=new Map();for(const doc of documents)for(const token of doc)frequency.set(token,(frequency.get(token)||0)+1);
 const weight=t=>Math.log(1+(corpus.length+1)/(frequency.get(t)||1));
 const total=[...query].reduce((n,t)=>n+weight(t),0)||1;
 const queryGrams=grams(incoming);
 return corpus.map((row,i)=>{
  const overlap=[...query].filter(t=>documents[i].has(t));
  const lexical=overlap.reduce((n,t)=>n+weight(t),0)/total;
  const chars=jaccard(queryGrams,grams(row.incoming));
  return {...row,score:Number((0.8*lexical+0.2*chars).toFixed(3)),
   topic:styleIntentCategory(row.incoming),matchedTerms:overlap.length};
 }).filter(row=>row.topic===topic && row.matchedTerms>0 && row.score>=(topic==='other'?0.34:0.24))
  .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
  .slice(0,Math.max(1,Math.min(3,Number(limit)||3)));
}
export function styleExamplesInstructions({incoming=''}={}){
 const chosen=findStyleExamples({incoming,limit:3});
 if(!chosen.length)return '';
 return [
  'EXEMPLOS APROVADOS DE ESTILO, NÃO SÃO FATOS COMERCIAIS:',
  'Só use o ritmo e o jeito espontâneo de conversar. NUNCA copie literalmente. Serviços, preços, promessas, políticas, disponibilidade e ações vêm exclusivamente das fontes aprovadas do servidor.',
  'Prefira ofertas simples e espontâneas a perguntas com cara de formulário. Exemplo de ESTILO: "Se quiser, posso dar uma olhada" em vez de "Você gostaria que eu realizasse uma análise?". Isso não autoriza dizer que executará algo que não está disponível. Não repita "se quiser" automaticamente em todo turno.',
  ...chosen.map((x,i)=>'Par '+(i+1)+' (score '+x.score+'): cliente '+JSON.stringify(x.incoming)+' / estilo de resposta '+JSON.stringify(x.reply)),
  'A mensagem atual e o histórico do cliente prevalecem. Você é assistente virtual: não finja ser uma pessoa.'
 ].join('\n').slice(0,1900);
}
