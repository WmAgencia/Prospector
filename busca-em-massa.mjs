// busca-em-massa.mjs — gera lista de queries para WebSearch em massa
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data', 'queries.json');

const SEGMENTOS = [
  'psicologo','psicologa','nutricionista','nutricionista esportiva',
  'dentista','clinica odontologica','ortodontista','endodontista',
  'clinica estetica','harmonizacao facial','botox','preenchimento',
  'dermatologista','medico dermatologista',
  'fisioterapeuta','pilates','rpg','quiropraxia',
  'veterinario','clinica veterinaria','pet shop banho e tosa',
  'personal trainer','academia musculacao','crossfit','funcional',
  'nutricionista materno infantil','nutricao comportamental',
  'advogado trabalhista','advogado familia','advogado criminalista',
  'escritorio de advocacia','advogado previdenciario',
  'arquiteto','designer de interiores','engenheiro civil',
  'corretor de imoveis','imobiliaria','creci',
  'contador','escritorio contabilidade','contabilidade',
  'barbearia','barbeiro','salao de beleza','cabeleireiro',
  'manicure','nail designer','designer de sobrancelhas','esteticista',
  'clinica de olhos','oftalmologista','otorrino',
  'clinica de imagem','medico cardiologista','pediatra','ginecologista',
  'clinica de massagem','massoterapeuta','quiromassagem',
  'escola de idiomas','professor ingles','reforco escolar',
  'fotografo','estudio fotografico','filmagem eventos',
  'buffet','doceria','confeitaria','restaurante',
];

const CIDADES = [
  'Sorocaba','Votorantim','Itu','Salto','Araçoiaba da Serra','Piedade',
  'São Roque','Mairinque','Alumínio','Ibiúna',
  'São Paulo','Campinas','Jundiaí','Santos','Guarulhos','Osasco',
  'Santo André','São Bernardo do Campo','São Caetano do Sul',
  'Barueri','Alphaville','Carapicuíba','Itapevi',
  'Zona Sul SP','Pinheiros SP','Vila Mariana SP','Moema SP',
  'Tatuí','Itapetininga','Boituva','Porto Feliz',
];

const SUFIXOS = [
  'whatsapp agendar',
  'instagram contato',
  'clinica consultorio',
  'particular Sorocaba',
  'particular',
];

const out = [];
for (const seg of SEGMENTOS) {
  for (const cid of CIDADES) {
    for (const suf of SUFIXOS.slice(0, 2)) {
      out.push({ segmento: seg, cidade: cid, query: `${seg} ${cid} ${suf}` });
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`${out.length} queries geradas em ${OUT}`);