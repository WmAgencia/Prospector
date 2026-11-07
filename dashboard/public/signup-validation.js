// Client-side field checks. These checks do NOT query government records,
// attest CPF ownership, or establish a match between the name and the CPF.
(function(root){
  'use strict';
  const digits=value=>String(value||'').replace(/\D/g,'').slice(0,11);
  const validCpf=value=>{
    const cpf=digits(value);
    if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
    for(const pos of [9,10]){
      let sum=0;for(let i=0;i<pos;i++)sum+=Number(cpf[i])*(pos+1-i);
      if(Number(cpf[pos])!==((sum*10)%11)%10)return false;
    }
    return true;
  };
  const nameIsComplete=value=>{
    const name=String(value||'').normalize('NFC').trim().replace(/\s+/g,' ');
    return name.length>=5&&name.length<=100&&name.split(' ').filter(Boolean).length>=2&&/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name);
  };
  const formatCpf=value=>{
    const cpf=digits(value);
    return cpf.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/(\d{3}\.\d{3}\.\d{3})(\d{1,2})$/,'$1-$2');
  };
  root.ProspectorSignupValidation=Object.freeze({digits,validCpf,nameIsComplete,formatCpf});
})(typeof window!=='undefined'?window:globalThis);
