// Read-only shared commercial method. Company-specific manuals never enter this module.
import fs from 'node:fs';
const documentUrl=new URL('./francisca-vendas-global.md',import.meta.url);
const globalDocument=fs.readFileSync(documentUrl,'utf8');
if(!globalDocument.startsWith('# FRANCISCA — MANUAL GLOBAL DE VENDAS')||globalDocument.length<4000)
 throw Error('GLOBAL_SALES_MANUAL_UNAVAILABLE');
export function globalSalesMarkdown(){return globalDocument;}
// The panel assistant uses a compact sales guide; customer replies get the full manual.
export function globalSalesVoiceGuide(){
 // The voice guide is extracted from the SAME shared Markdown, not maintained separately.
 const sections=globalDocument.split(/(?=^## \d+\.)/m);
 return sections.filter(s=>/^## [1234579]\./.test(s)).map(s=>s.slice(0,760)).join('\n\n').slice(0,5500);
}
export const GLOBAL_SALES_FILENAME='francisca-vendas-global.md';
export const GLOBAL_SALES_VERSION='1.0';
