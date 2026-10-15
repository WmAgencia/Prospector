import test from 'node:test';import assert from 'node:assert/strict';
import {isPairingRestart} from '../dashboard/whatsapp-reliability.mjs';
test('515 sinaliza reconexão de autenticação, não expiração da sessão',()=>{
 assert.equal(isPairingRestart(515,515),true);
 assert.equal(isPairingRestart('515',515),true);
 assert.equal(isPairingRestart(401,515),false);
 assert.equal(isPairingRestart(408,515),false);
});
