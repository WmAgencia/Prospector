# Etapa: inteligência de conversas WhatsApp — rascunho isolado

## Implementado no branch
- `dashboard/whatsapp-intelligence.mjs`: análise agregada **somente leitura**, sem acesso ao WA-AKG, sem envios e sem uso de Groq.
- Progresso de 0 a 100% por lote; contagem de recebidas/enviadas, conversas com retorno e resultados informados pelo CRM.
- Padrões de perguntas, convites para o próximo passo e mensagens curtas, exigindo ao menos 5 conversas por categoria para apresentar taxas.
- Relatório e playbook Markdown, ambos **pendentes de revisão humana**.
- Separação obrigatória por empresa, exclusão de grupos, deduplicação de mensagens pelo ID e limite de tamanho do lote.
- Documentos gerados não incluem conteúdo integral, nomes, JIDs ou números de telefone.

## Próxima integração, dependente de validação real
1. Associar e verificar a permissão de cada sessão WA-AKG à empresa autenticada; proibido usar uma sessão global para contas diferentes.
2. Criar leitura paginada de conversas autorizadas com checkpoint, cancelamento e progresso recuperável; checar consentimentos e retenção.
3. Persistir apenas agregados e estados de job, com filtros de acesso; não reter conversas brutas no relatório.
4. Exibir progresso e aprovação do arquivo no painel de Inteligência Artificial.
5. Somente após aprovação explícita, disponibilizar orientação contextual para a Francisca — sem habilitar respostas automáticas por essa mudança.
6. Executar validação em ambiente controlado com integração real e confirmar autorização antes do deploy.

## Restrições
Nenhum dado real foi analisado nesta etapa. Resultados são rótulos do CRM, não inferências; associação não prova causalidade. Nenhum envio de WhatsApp, campanha ou deploy foi ativado.
