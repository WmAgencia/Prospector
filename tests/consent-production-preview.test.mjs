import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {previewConsentCounts,CONSENT_PREVIEW_VARIABLE} from '../dashboard/consent-production-preview.mjs';

test('production preview shows real queue numbers with filter toggled without mutating consent',()=>{
 const production={total:434,ready:0,awaitingConsent:434,missingWhatsapp:0,suppressed:0};
 const on=previewConsentCounts(production,{required:true});
 const off=previewConsentCounts(production,{required:false});
 assert.equal(on.visibleReady,0);
 assert.equal(off.visibleReady,434);
 assert.equal(on.readyWithConsent,0);
 assert.equal(off.readyWithConsent,0);
 assert.equal(on.actualWhatsAppConsentChecksAlwaysOn,true);
 assert.equal(off.previewOnly,true);
 assert.equal(off.productionData,true);
 assert.equal(CONSENT_PREVIEW_VARIABLE,'PROSPECTOR_CONSENT_PREVIEW_REQUIRED');
});
test('cannot mark suppressed or missing phones as ready in read-only preview',()=>{
 const result=previewConsentCounts({total:100,ready:10,awaitingConsent:50,missingWhatsapp:25,suppressed:15},{required:false});
 assert.equal(result.visibleReady,60);
 assert.equal(result.readyWithConsent,10);
});
test('preview route is authenticated and no send pipeline checks the preview variable',()=>{
 const server=fs.readFileSync(new URL('../dashboard/server.mjs',import.meta.url),'utf8');
 const queue=fs.readFileSync(new URL('../dashboard/prospecting-queue.mjs',import.meta.url),'utf8');
 assert.ok(server.indexOf("if(!protectedAccess(req,res,url.pathname))return;")<server.indexOf("pathname==='/consent-preview'"));
 assert.match(server,/pathname==='\/api\/outreach\/consent-preview'/);
 assert.doesNotMatch(queue,/PROSPECTOR_CONSENT_PREVIEW_REQUIRED/);
 assert.match(queue,/requiresDocumentedOptIn\(\)&&!documentedOptIn/);
});
