# Validação da Francisca — 23 cenários corrigidos + 77 restantes

**Data:** 4 de novembro de 2026 — America/Sao_Paulo  
**Branch:** `fix/francisca-23-regressions-100-scenarios` / PR #91  
**Ambiente:** GitHub Actions + Railway Function isolada; nenhuma chamada aos endpoints de envio do WA-AKG.

## 1. Resultado de testes (evidências)

| Teste | Resultado | Observação |
|---|---|---|
| Regressões/integrados em CI | **439 aprovados / 0 falhas** | [Actions run 41871374706](https://github.com/WmAgencia/Prospector/actions/runs/41871374706). Inclui dois testes de webhook de entrada/fallback com transporte mock. |
| 100 clientes fictícios — duas funções de agentes em memória | **100/100 sem alertas nos critérios implementados** | 10 nichos, 10 perfis por nicho, múltiplos turnos, 0 WhatsApp. Isso valida a lógica determinística, não 100 conversas generativas. |
| 77 clientes restantes — híbrido com **Groq atual** e respostas fixas aprovadas | **77 executados: 67 sem alertas, 10 bloqueios seguros** | 56 chamadas Groq; 37 respostas de cliente geradas por Groq 20b, 7 textos aprovados do `aiDraft` real Groq 120b, 2 HTTP 429, 0 WhatsApp. Os 10 erros foram bloqueados antes de qualquer envio. |
| Reexecução dirigida dos 10 bloqueios, após novos consertos | **10/10 sem alertas** | 11 chamadas Groq; 10 réplicas de cliente por Groq; 1 resposta livre descartada e substituída por fallback seguro; 0 HTTP 429; 0 WhatsApp. |

**Atenção à metodologia:** na bateria híbrida, as mensagens padrão de saudação, apresentação, preço e FAQ foram elaboradas deterministicamente pelas funções aprovadas, enquanto os turnos abertos usaram o mesmo `aiDraft` e o modelo `openai/gpt-oss-120b` do Prospector atual. Não é correto concluir que houve 100 negociações livres, integralmente IA-vs-IA. Os indicadores acima são específicos ao conjunto de cenários e ao avaliador definido.

## 2. Erros corrigidos

1. **Apresentação:** primeira resposta após a saudação não ignora Wesley em pergunta precoce de preço.
2. **Identidade:** nome pessoal só é usado quando o cadastro contém verificação explícita; nomes de Google Maps não viram saudações longas ou nomes inventados.
3. **Atendimento automático:** mensagens com menu/solicitação automática são classificadas `AUTO_REPLY`, sem abordagem subsequente.
4. **Recusa e opt-out:** frases naturais como “não temos interesse”, “já temos quem cuide” e “parem de nos contatar” interrompem o fluxo; não insistir.
5. **Preço:** oferta-base de portfólio = R$550; domínio 12 meses; previsão de três dias após materiais/escopo; outras modalidades continuam necessitando de autorização explícita do proprietário.
6. **SEO:** sem prometer posição 1 no Google; comparação matemática de R$550 com R$2700–3000 equivale a cerca de 80% de desconto, não 90%.
7. **Prazos:** data projetada por três dias do calendário em fuso America/Sao_Paulo (4/11 para 7/11); não manter campanha de portfólio vencida como prazo inventado.
8. **Interessados:** intenção explícita é encaminhada ao humano em vez de desencadear pedido repetido de aprovação de preço.
9. **Alucinações operacionais:** nova checagem rejeita mensagens afirmando agendamento/remoção/contrato executados sem operação real.
10. **Bloqueio produtivo:** se o Groq sugerir preço, prazo ou ação não aprovada em conversa de portfólio autorizada, o servidor substitui por uma resposta segura verificada e registra evento de auditoria.
11. **Aprovação financeira antiga:** sugestão de portfólio de R$350 corrigida para R$550; modelo de pagamento 50/50 e prazo fixo de quatro dias retirados dos templates de aprovação.

## 3. Limitações pendentes antes de produção

- PR #91 **não foi mesclado nem publicado em produção**: não alterar respostas de contatos reais sem aprovação dos gates de produção.
- Verificar consentimento/expectativa aplicável para início de conversas comerciais no WhatsApp: listagens públicas e telefones obtidos por pesquisa não provam opt-in.
- Conferir o estado de fila/pendências, deduplicação, supressões e mensagens UNKNOWN **no banco real** antes de retomar envios; testes aqui ocorreram em ambiente isolado.
- A personalização do ramo usa classificação determinística por categoria, **não representa pesquisa aprofundada individual com verificação da empresa**. O enriquecimento empresarial detalhado ainda requer etapa específica.
- Os 23 casos originais foram cobertos pela regressão e 100-casos determinística, mas **não** foram todos repetidos com um novo diálogo completo Groq-vs-Groq após o último patch. Os 77 restantes e os dez bloqueios foram testados com Groq pelo método híbrido descrito.
- Um teste determinístico que não detecta falhas não é certificação de qualidade geral das respostas generativas ou de conformidade comercial.

## 4. Segurança do laboratório

O laboratório só carregou código sem WA-AKG e interceptou `fetch` para permitir exclusivamente `https://api.groq.com/openai/v1/`. Não houve números reais de clientes, webhooks, nem banco de produção. Depois da execução, a Railway Function temporária foi substituída por código inerte, e as variáveis `LAB_GROQ_API_KEY`, `PROSPECTOR_OWNER_ACCESS` foram esvaziadas. Último deployment da função temporária: `34ed9e15-1ddc-4eb5-b82a-b9e1e237eac2` (SUCCESS).

**Próximo gate recomendado**: auditar elegibilidade e consentimento dos destinatários, fazer replay do motor completo com SQLite temporário/transport fake sob concorrência, e publicar após aprovação explícita de mudança em produção.
