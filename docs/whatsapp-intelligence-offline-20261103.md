# Inteligência de conversas WhatsApp — implementação integrada

## Fluxo

1. Abra **Inteligência artificial** no painel privado do Prospector.
2. Selecione as sessões WhatsApp conectadas e autorizadas. Por padrão somente a sessão principal do Prospector está liberada.
3. Confirme autorização e clique em **Iniciar análise**.
4. Acompanhe o progresso persistente de 0–100% e cancele quando quiser. Execuções interrompidas são marcadas e não reiniciadas automaticamente.
5. Baixe **RELATORIO_CONVERSAS.md** e **PLAYBOOK.md**.
6. Revise o playbook e aprove explicitamente. Somente após aprovação ele orientará os rascunhos comerciais Groq da Francisca. Não habilita disparos.
7. Desative o playbook a qualquer momento.

## Administração e limites

- Login privado exigido em produção. Nenhuma rota de análise dispensa autenticação.
- Sessões permitidas pelo parâmetro de servidor WA_AKG_ANALYTICS_ALLOWED_SESSIONS, com IDs separados por vírgula. Sem ele, a sessão principal é usada.
- Este painel é o workspace privado Consecom (company_id=consecom), **não uma aplicação multiempresa**. Clientes externos independentes requerem contas por organização, vínculo e consentimento por sessão e políticas de retenção.
- Máximo de 10.000 conversas por execução; últimas 5.000 mensagens retornadas pelo WA-AKG em cada conversa. A cobertura depende da disponibilidade do histórico remoto.
- Grupos excluídos. Falhas parciais bloqueiam aprovação do playbook até uma nova análise completa.
- Só resultados confirmados pelo CRM (sales_outcomes) contam como interesse, venda e recusa. Ausência de dados gera resultado não classificado.
- Heurísticas de mensagens curtas, perguntas e convites ao próximo passo são **associações, não causalidade**. Sugestões são condicionadas a mínimo de 5 casos por grupo e diferença de 15 pontos percentuais.
- O conteúdo privado é lido em memória e descartado depois da extração de sinais. Apenas agregados e relatórios sem identificadores são persistidos. Sem números, nomes, JIDs, trechos literais ou dados de autenticação nos relatórios.
- Nenhum texto do WhatsApp é enviado a provedores de IA durante a análise. Groq recebe somente o playbook agregado depois de aprovado.
- As rotas da API ficam sob /api/ai/whatsapp-intelligence/: sessions, status, start, cancel, document e review.
- Não há envio de mensagens, campanha, prospect ou mudança na cadência causado pela inteligência de conversas.

## Verificação

Execute npm test. O CI testa os fluxos e inclui verificação de sintaxe e smoke da API (status e bloqueio de execução sem consentimento). Confirme o deploy e a saúde dos serviços do Railway.

## Limitações claras

A integração atual **não** analisa conversas não expostas pelo gateway, não transcreve áudios, não faz treinamento de pesos do modelo e não cria isolamento SaaS para outras empresas. Essas capacidades precisam de uma etapa posterior com infraestrutura e consentimentos próprios.
