# Correções e verificação funcional — 30/10/2026

Base: `35c6d44ba7913419603eecadba9056b74da6830d`.

## Mudanças

- Validação correta do destinatário de áudio e marcação/desmarcação de cliente pela interface.
- Sessão WhatsApp selecionada não usa status de outra identidade.
- Recontato e apresentação renovados após três meses de calendário, incluindo fim de mês. A prévia usa a mesma elegibilidade da fila.
- Revalidação depois de operações lentas: mensagens antigas não sobrescrevem recusa, opt-out, vínculo de cliente ou atendimento humano posterior.
- Texto confirmado permanece no histórico quando o áudio complementar falha, sem repetir entregas incertas.
- Reimportação preenche metadados vazios e rejeita colisões de identidade, sem conceder consentimento.
- Resultado comercial admite opt-out mais forte e nova conversa comprovada, preservando bloqueios e vendas.
- Gateway renova cookies internos expirados/revogados, reúne autenticações concorrentes e limita nova tentativa.
- Integração MCP autenticada com OAuth/PKCE, escopos separados e consentimento do operador. Consulta/preparação não enviam; o escopo opcional de envio exige aprovação explícita e reutiliza a fila existente.

## Evidência de teste

- `node --test`: **274 testes aprovados**, zero falhas, cancelados ou ignorados, incluindo oito testes do verificador de produção autorizado. Base anterior: 238 testes. Chave Groq removida apenas do processo de teste.
- Sintaxe: **151 arquivos JavaScript/ES modules** verificados sem falhas.
- `bun build infra/railway/prospector-ui.ts --target=bun`: compilação concluída.
- `git diff --check`: sem erros.
- Chrome headless com serviços simulados: cinco telas, envio de texto, envio de áudio, marcar/desmarcar cliente e viewport móvel sem overflow horizontal; zero erros JavaScript. Quatro requisições de escrita simuladas; zero mensagens reais.
- HTTP real local: servidor completo, descoberta MCP, proteção de origem, autenticação Bearer; fluxo OAuth/PKCE, replay, recurso, redirecionamento, renovação, isolamento de escopos, fila e cancelamento. Bancos temporários e provedores simulados.
- Revisão independente: corrigido conflito de origem entre proxy e backend; revisão subsequente sem achados P1/P2.

## Aplicação em produção

Esta verificação não é uma implantação nem comprovação de entrega externa. A produção foi consultada apenas para inventário: backend ainda executava o commit base, sem variáveis MCP. Nenhum dado de cliente ou credencial foi alterado.

Após aprovação de publicação:

1. Integrar a branch revisada e aguardar CI do commit final.
2. Implantar o backend e sincronizar a fonte `infra/railway/prospector-ui.ts` na Railway Function da interface; atualizar apenas GitHub não altera automaticamente o código dessa Function.
3. Definir `MCP_ENABLED=true` e `MCP_PUBLIC_URL=https://prospector-ui-production.up.railway.app/mcp` no backend se este for o domínio escolhido. Confirmar uma réplica ou afinidade para o fluxo de aprovação em memória e limites de requisição na borda.
4. Conferir a sessão WhatsApp efetivamente selecionada e os estados existentes da fila. Não habilitar campanhas ou testes de envio por causa do deploy.
5. Verificar `/health`, acesso privado, desafio Bearer de `/mcp`, descoberta e fluxo de autorização no cliente desejado.
6. Conectar o cliente MCP e conceder somente os escopos desejados. Envio requer autorização separada `prospector:outreach`, aprovação explícita e consentimento já documentado dos contatos.

Não é possível afirmar entrega real de WhatsApp ou compatibilidade com uma conta específica do cliente sem concluir sua conexão e fazer um teste com destinatário autorizado. Os testes desta entrega não contactam clientes.

## Teste real autorizado pelo operador

O operador aprovou a publicação e um teste para seu telefone em 30/10/2026. O módulo `dashboard/production-verification.mjs` exige `PROSPECTOR_PRODUCTION_VERIFY_ENABLED=true` e um UUID em `PROSPECTOR_PRODUCTION_VERIFY_ID`. O destinatário é fixo; a rotina não altera consentimento, clientes, campanhas ou filas. Confere a identidade completa do remetente e a sessão antes do envio, respeita supressões e reserva as duas partes em SQLite antes de qualquer tentativa. Um UUID já reservado não é repetido, mesmo depois de reiniciar ou variar a capitalização. Síntese indisponível é detectada antes da reserva. Falhas e resultados incertos não são reenviados automaticamente.

O teste solicita um texto e um áudio Francisca. O log distingue aceitação pelo provedor de confirmação no aparelho. Após executar, desativar `PROSPECTOR_PRODUCTION_VERIFY_ENABLED` e os antigos flags `RUN_*` de smoke para não programar novos testes em reinícios.
