# Francisca Natural — port para base histórica (2026-11-09)

## Origem e escopo
- **Base preservada:** `fix/francisca-natural-four-stages-20261108`, commit `a855ff10a3aa5ee4ae204bb3e0688d7def137b65`.
- **Origem dos recursos de IA:** `feature/francisca-natural-3-consolidated`.
- **Destino exclusivo:** `feature/francisca-natural-legacy-base-20261109`.
- A branch histórica e a versão em produção não são modificadas por esta migração.

## Recursos incorporados
- Linguagem coloquial em português brasileiro, contexto contínuo e menor repetição de saudações.
- Política compacta Natural v3 e memória de exemplos artificiais/revisados, com aprovação explícita.
- Cérebro comercial consultivo v2 e registros agregados de qualidade, sem exposição de transcrições.
- Guardrails contra Pix inventado, cobrança alegada sem confirmação e promessas comerciais não verificadas.
- Limites e cooldown para chamadas Groq, sem failover em 429.
- Treinamento com laboratório de conversa simulada, avaliação de 100 cenários e revisão de estilo.
- Funil comercial somente leitura, exibido na visão geral.
- Cadência aleatória de 90–110 segundos, com janela de despacho conservadora e controle de digitação.
- Seleção estrita dos dois números autenticados pelo WA-AKG (finais 7336 e 2994), bloqueando outras sessões.
- Pesquisa de contatos de empresas no Maps a partir das 00h no horário de Brasília, sem atribuir consentimento aos contatos.

## Proteção da lógica original
Arquivos preservados byte a byte da base:
- `dashboard/outreach-queue.mjs`
- `dashboard/prospecting-introduction.mjs`
- `dashboard/waakg-bridge.mjs`
- `dashboard/prospection-resume.mjs`
- `dashboard/prospection-pause.mjs`
- `dashboard/outreach-consent-control.mjs`
- `dashboard/authorized-outreach.mjs`
- `dashboard/permission-invitation.mjs`

A CI compara os arquivos acima diretamente com o commit-base. O módulo `dashboard/prospecting-queue.mjs` recebeu somente verificações de intervalo, digitação, rotação e observabilidade; a CI verifica separadamente que o texto da função `requiresDocumentedOptIn` e TODO o corpo de `eligibleLead` (inclusive `automaticApproved`, supressões e recontatos) permanece exatamente igual ao commit-base. Nenhuma aprovação de novo contato é inferida do Maps.

O fluxo antigo de `prospecting-introduction.mjs` não foi transplantado da branch mais nova, pois seus critérios para registrar e continuar a conversa fazem parte da lógica de consentimento que deve permanecer intacta.

## Ativação das melhorias de IA
As quatro flags são **independentes dos controles de abordagem** e somente funcionam no master ou worker interno Consecom:
```env
FRANCISCA_NATURAL_V1_ENABLED=true
FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED=true
FRANCISCA_STYLE_EXAMPLES_V1_ENABLED=true
FRANCISCA_COMPACT_PROMPT_V3_ENABLED=true
```
Estas flags devem ser configuradas no ambiente escolhido na fase de publicação/testes; não são configuradas automaticamente pela criação da branch.

## Segurança operacional e testes
- Não há envios reais do WhatsApp no laboratório e no benchmark.
- As avaliações de estilo são heurísticas offline; não demonstram taxa de conversão nem equivalem a uma rodada end-to-end.
- `node --test tests/francisca-natural-conversation.test.mjs tests/francisca-natural-v3.test.mjs tests/francisca-style-examples.test.mjs tests/francisca-commercial-brain-v2.test.mjs tests/francisca-lab-pix-safety.test.mjs tests/groq-rate-control-v3.test.mjs`
- `node scripts/francisca-evaluate-100.mjs`
- A publicação e a ativação de flags devem manter a pausa geral de prospecção até validação de produção.
