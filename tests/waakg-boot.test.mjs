import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const content=fs.readFileSync(new URL('../waakg-voice/Dockerfile',import.meta.url),'utf8');
test('WA-AKG boot does not block API behind redundant MySQL admin write',()=>{
 assert.match(content,/CMD \["sh", "-c", "npx prisma db push && exec node node_modules\/tsx\/dist\/cli\.mjs src\/server\/index\.ts"\]/);
 assert.doesNotMatch(content,/CMD.*setup-admin\.js/);
});
