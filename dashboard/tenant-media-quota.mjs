// Resource guard for shared-volume SaaS clients. The Consecom internal
// workspace remains subject to its existing, separately managed media flow.
export const TENANT_MEDIA_LIMITS=Object.freeze({
 maxFiles:120,
 maxTotalBytes:100*1024*1024,
 maxUploadsPerMinute:10
});

export function evaluateTenantMediaQuota({files=0,totalBytes=0,uploadsLastMinute=0,incomingBytes=0}={},limits=TENANT_MEDIA_LIMITS){
 const values=[files,totalBytes,uploadsLastMinute,incomingBytes];
 if(values.some(x=>!Number.isSafeInteger(x)||x<0))return {ok:false,status:400,code:'MEDIA_QUOTA_INVALID_COUNTERS'};
 if(incomingBytes===0)return {ok:false,status:400,code:'MEDIA_FILE_EMPTY'};
 if(files>=limits.maxFiles)return {ok:false,status:413,code:'TENANT_MEDIA_FILE_LIMIT'};
 if(incomingBytes>limits.maxTotalBytes-totalBytes)return {ok:false,status:413,code:'TENANT_MEDIA_STORAGE_LIMIT'};
 if(uploadsLastMinute>=limits.maxUploadsPerMinute)return {ok:false,status:429,code:'TENANT_MEDIA_UPLOAD_RATE_LIMIT'};
 return {ok:true,status:200,remainingBytes:limits.maxTotalBytes-totalBytes-incomingBytes};
}

export function tenantMediaQuotaMessage(code){
 switch(code){
  case 'TENANT_MEDIA_FILE_LIMIT':
  case 'TENANT_MEDIA_STORAGE_LIMIT':
   return 'O espaço de mídia deste teste atingiu o limite. Remova materiais antigos ou contate o suporte antes de enviar novos arquivos.';
  case 'TENANT_MEDIA_UPLOAD_RATE_LIMIT':
   return 'Muitos uploads em um minuto. Aguarde um pouco antes de tentar novamente.';
  default:return 'Não foi possível validar o arquivo para upload.';
 }
}
