// Run: node scripts/francisca-evaluate-100.mjs
// Offline fixture calibration: not a claim about model performance.
// The evaluator accepts real model outputs through evaluateFrancisca100({answers}).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-eval-100-'));
const {generate100FranciscaScenarios,evaluateFrancisca100}=await import('../dashboard/francisca-quality-evaluator.mjs');
const {findStyleExamples}=await import('../dashboard/francisca-style-examples.mjs');
const cases=generate100FranciscaScenarios();
process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='true';
const reference=evaluateFrancisca100({cases});
const robotic=evaluateFrancisca100({cases,answers:cases.map(x=>x.robotic)});
const categories=[...new Set(cases.map(x=>x.category))];
const exampleCoverage=cases.reduce((n,x)=>n+Number(findStyleExamples({incoming:x.incoming,limit:3}).length>0),0);
const output={
 title:'Francisca Natural 3 — 100 situações fictícias',
 kind:'OFFLINE_REFERENCE_CALIBRATION',
 totalCases:cases.length,categories,
 reference:{passes:reference.passed,average:reference.averageScore,flags:reference.flags},
 robotStyle:{passes:robotic.passed,average:robotic.averageScore,flags:robotic.flags},
 retrievalCoverage:exampleCoverage,
 note:'Os scores avaliam respostas fictícias de referência, NÃO respostas reais do Groq. O teste real de modelo exige seleção de um único modelo, controle de limites do provedor e revisão humana.',
 cases:cases.map((x,i)=>({id:x.id,category:x.category,input:x.incoming,styleReference:x.reference,
  referenceGrade:reference.results[i].grade,roboticGrade:robotic.results[i].grade}))
};
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/francisca-eval-100.json',JSON.stringify(output,null,2),'utf8');
fs.writeFileSync('artifacts/francisca-eval-100.md',[
 '# Francisca Natural 3 — avaliação de 100 situações fictícias',
 '',
 '**Este é um diagnóstico de calibração com respostas fictícias, não uma nota da IA em produção.**',
 '',
 '- Casos: '+cases.length+' em '+categories.length+' categorias',
 '- Respostas de referência que passaram nos critérios heurísticos: '+reference.passed+' de 100',
 '- Respostas propositadamente robóticas aprovadas indevidamente: '+robotic.passed+' de 100',
 '- Situações em que foi encontrado pelo menos um exemplo de estilo compatível: '+exampleCoverage+' de 100',
 '',
 'As regras são só indicadores: formalidade, bordões, pergunta repetitiva, promessa não verificada, pedido indevido de dados Pix, repetição de cumprimentos. Não julgam se a venda é convincente nem se os fatos estão corretos.',
 '',
 'Para medir qualidade real, reúna respostas do **mesmo modelo** em condições comparáveis, com orçamento de requisições e revisão humana. Nunca executar 100 chamadas em rajada.',
 ''
].join('\n'),'utf8');
console.log(JSON.stringify({kind:output.kind,counts:{cases:100,referencePassed:reference.passed,roboticPassed:robotic.passed,retrievalCoverage:exampleCoverage},
 artifact:'artifacts/francisca-eval-100.json',note:output.note}));
if(cases.length!==100||new Set(cases.map(x=>x.id)).size!==100||reference.passed<90||robotic.passed>35)process.exitCode=1;
