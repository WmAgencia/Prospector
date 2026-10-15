import test from 'node:test';import assert from 'node:assert/strict';
import {validVersion,classifyDisconnect,retryDelay,currentWebVersion} from '../dashboard/whatsapp-reliability.mjs';
test('WhatsApp só usa versão Web verificada',async()=>{
 assert.deepEqual(await currentWebVersion({fetchLatestWaWebVersion:async()=>({isLatest:true,version:[2,3000,1048000000]})}),[2,3000,1048000000]);
 await assert.rejects(()=>currentWebVersion({fetchLatestWaWebVersion:async()=>({isLatest:false,version:[2,3000,1]})}),/versão atual/);
 await assert.rejects(()=>currentWebVersion({}),/não oferece/);
 assert.equal(validVersion([2,3000,1048000000]),true);
 assert.equal(validVersion([2,'3000',0]),false);
});
test('logout não é confundido com desconexão recuperável',()=>{
 assert.equal(classifyDisconnect(401,401),'LOGGED_OUT');
 assert.equal(classifyDisconnect(408,401),'DISCONNECTED');
 assert.equal(retryDelay(1),15000);
 assert.equal(retryDelay(4),120000);
});
