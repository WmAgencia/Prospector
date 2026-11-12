import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTenantMediaQuota,TENANT_MEDIA_LIMITS} from '../dashboard/tenant-media-quota.mjs';

test('normal training portfolio upload fits within client quota',()=>{
 const x=evaluateTenantMediaQuota({files:3,totalBytes:18*1024*1024,uploadsLastMinute:2,incomingBytes:2*1024*1024});
 assert.equal(x.ok,true);assert.equal(x.remainingBytes,80*1024*1024);
});
test('a single client cannot exhaust the shared volume with files',()=>{
 const exhausted=evaluateTenantMediaQuota({
  files:5,totalBytes:99*1024*1024,uploadsLastMinute:1,incomingBytes:2*1024*1024
 });
 assert.deepEqual({ok:exhausted.ok,status:exhausted.status,code:exhausted.code},
  {ok:false,status:413,code:'TENANT_MEDIA_STORAGE_LIMIT'});
 const many=evaluateTenantMediaQuota({files:TENANT_MEDIA_LIMITS.maxFiles,totalBytes:1,incomingBytes:1});
 assert.equal(many.code,'TENANT_MEDIA_FILE_LIMIT');
});
test('bursts are limited before writing an uploaded file',()=>{
 const x=evaluateTenantMediaQuota({files:10,totalBytes:100,uploadsLastMinute:10,incomingBytes:50});
 assert.equal(x.status,429);assert.equal(x.code,'TENANT_MEDIA_UPLOAD_RATE_LIMIT');
});
test('invalid or negative counters fail closed',()=>{
 assert.equal(evaluateTenantMediaQuota({files:-1,incomingBytes:200}).ok,false);
 assert.equal(evaluateTenantMediaQuota({files:0,incomingBytes:0}).status,400);
});
