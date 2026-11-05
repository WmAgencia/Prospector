# Auditoria técnica — 5 de novembro de 2026

Base: `6c1adfa256e7264b28ff6e15d12b81a2842629b4` de WmAgencia/Prospector.

## Problemas confirmados e corrigidos

1. **Dependência vulnerável:** `follow-redirects` 1.16.0 estava no lockfile e foi atualizado para 1.16.2. O npm apontava GHSA-mrwp-f3q8-3g9p, de gravidade alta; depois da atualização, `npm audit` e `npm audit --omit=dev` não apontam vulnerabilidades conhecidas.
2. **Tentativas de acesso:** `/api/auth/exchange` usava o primeiro valor de `X-Forwarded-For`, permitindo trocar a identidade do limite de tentativas. A origem padrão agora é o endereço do socket. O armazenamento tem limite de 10.000 identidades e remove entradas expiradas; quando cheio, rejeita novas identidades em vez de remover bloqueios ativos.
3. **Evidência do site:** manter `HAS_WEBSITE` e alterar a URL dispensava validação e revisão humana. Mudanças de URL de classificações revisadas agora exigem nova evidência e passam novamente pela validação da URL.
4. **Recuperação MySQL:** a rotina específica de três binlogs sobrescrevia o índice com apenas `.000003`, mesmo havendo logs posteriores. Ela agora exige o índice esperado, a presença do terceiro log e a ausência de outros binlogs antes de modificar arquivos. Novos testes verificam preservação integral com um quarto log, listado ou não no índice.

## Validação executada

- Node 24.19.0, Windows; Git Bash no PATH para os testes POSIX.
- `npm ci --ignore-scripts`: instalação do lockfile.
- `npm test`: **450 aprovados, zero falhas, zero ignorados**.
- Verificação de sintaxe dos 114 módulos/scripts em `dashboard` e `preview`; `simple-app.js` verificado como módulo ES, como no navegador.
- `git diff --check` sem problemas.
- Testes de OAuth/MCP, consentimento, filas, deduplicação, identidade do proprietário, interface e chamadas usam as simulações e bancos temporários da suíte.

## Configuração de proxy

`PROSPECTOR_TRUST_PROXY=true` permite usar o último IP válido de `X-Forwarded-For`. Só habilitar quando o servidor for acessível exclusivamente por um proxy controlado que sobrescreva esse cabeçalho ou acrescente o endereço real do cliente ao final. Sem essa opção, clientes atrás do mesmo proxy compartilham o limite de oito erros em dez minutos. O padrão usa o socket e não confia em cabeçalhos enviados pelo cliente.

## Alcance e limites

Foram examinados configuração, dependências, servidor HTTP/autenticação, evidência de sites, recuperação MySQL e cobertura automatizada dos fluxos operacionais. Esta auditoria não certifica ausência de outros defeitos. Não houve validação de mensagens ou chamadas reais, dados de produção, credenciais, configurações remotas nem recuperação de um volume MySQL real.

O `AUDITORIA.md` de 4 de novembro é um registro histórico: o código atual já exige opção explícita de ambiente para ativação inicial autônoma, verifica aceite explícito em `acceptPresentation` e reconhece `PARE` e `sair`. Portanto esses itens antigos não são tratados aqui como defeitos ainda presentes. As opções de abordagem fria e convite continuam existindo no produto; esta revisão não alterou essas decisões de operação.
