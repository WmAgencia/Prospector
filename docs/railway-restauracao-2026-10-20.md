# Consecom Prospector — restauração Railway (captura 20/10/2026)

> **Inventário de configuração, não backup de dados.** Obtido da integração Railway no dia 20/10/2026. Sem valores de tokens, senhas ou credenciais. O projeto antigo estava com ambos os serviços **offline**, sem deployments ativos, e tentativas de redeploy retornaram `Your trial has expired`. **Não apagar a conta/projeto até garantir exportação dos dados persistentes.**

## Origens do projeto

- GitHub: https://github.com/WmAgencia/Prospector
- Branch de produção: `main`
- Projeto Railway: `prospector-consecom`
- Ambiente: `production`
- Workspace antigo: `Gilberto Neves's Projects`
- Projeto antigo (ID histórico): `6eb40253-34a6-400e-982c-b5ab21904d88`
- Fuso operacional: `America/Sao_Paulo`
- Região de implantação: `sfo`
- Backups de código: GitHub; função UI copiada para [infra/railway/prospector-ui.ts](../infra/railway/prospector-ui.ts).
- IDs de serviços, volume e domains do projeto antigo **não devem ser reutilizados** para criar recursos na nova conta.

## Serviço 1: backend `prospector-operacional`

- Fonte: repositório GitHub `WmAgencia/Prospector`, branch `main`; implantação a partir de push
- Build atual configurado: `RAILPACK` / build environment `V3`
- Runtime de serviço Railway: `V2`
- Comando de início: `node dashboard/server.mjs`
- Porta do serviço: `3000`; usar variável `PORT=3000` para reproduzir
- Health check: `/health`
- Domínio antigo: `prospector-operacional-production.up.railway.app`; obter novo domínio na recriação
- Réplicas: 1; região `sfo`
- Volume persistente: `prospector-persistent-data` (500 MB), montado em `/data`
- No `Dockerfile` original existem Node 22, ffmpeg, npm ci e padrão de startup; o serviço Railway observado usa builder RAILPACK e comando acima. Escolher o builder deliberadamente, não presumir que o Dockerfile será usado no novo serviço.
- O agendador de busca e a fila de envio funcionam dentro do processo Node (`dashboard/server.mjs`), não em cron Railway separado. A rotina não depende de navegador aberto.
- Banco de dados real no código: SQLite, com dados no diretório configurado; confirmar caminhos e integridade ao restaurar o volume.

**Variáveis de aplicação que existiam** (nomes somente, valores precisam ser fornecidos/restaurados em canal seguro):

```dotenv
ADMIN_ACCESS_TOKEN=<recriar_seguro>
ADMIN_PASSWORD=<recriar_seguro>
ADMIN_SESSION_SECRET=<recriar_seguro>
ADMIN_USERNAME=<reconfigurar>
APP_BASE_URL=<nova_url_publica>
NODE_ENV=production
NODE_OPTIONS=<verificar_valor_anterior>
OVERPASS_ENDPOINT=<verificar_endpoint_configurado>
PORT=3000
PROSPECTOR_CAMPAIGN_TEST=<reavaliar>
PROSPECTOR_DATA_DIR=/data
PROSPECTOR_MEDIA_RESTORE_URL=<se_necessario>
PROSPECTOR_SESSION_DIR=/data/wa-session
PROSPECTOR_TEST_DELIVERY_RETRY=<reavaliar>
PROSPECTOR_TEST_DIAGNOSTICS_UNTIL=<reavaliar>
PROSPECTOR_TEST_REPLY_RECOVERY=<reavaliar>
STUDIO_SYNC_ENABLED=<reavaliar>
```

Linhas acima representam **recomendações ou marcadores**, não exportação dos valores antigos. Em especial, testes e restauração de mídia não devem ser ativados cegamente na nova conta.

## Serviço 2: gateway `prospector-ui`

- Tipo: Railway Function executada em **Bun 1.4.0**, origem de imagem `ghcr.io/railwayapp/function-bun:1.4.0`.
- Código integral copiado do Railway para [infra/railway/prospector-ui.ts](../infra/railway/prospector-ui.ts) em 20/10/2026. **Reutilizar este código na nova Function.**
- Função: autenticação por link privado e sessão, seguida de proxy para backend; não substituir por HTML estático ou apontar diretamente ao backend sem proteção.
- Réplicas: 1, região `sfo`, **sem volume** e **sem cron**.
- Domínio antigo: `prospector-ui-production.up.railway.app`; endereço novo pode mudar.

**Variáveis de aplicação que existiam** (nomes somente):

```dotenv
ACCESS_LINK_TOKEN=<gerar_token_longo_seguro>
ACCESS_SESSION_KEY=<gerar_segredo_longo_seguro>
UPSTREAM_ACCESS_TOKEN=<mesmo_token_do_backend_ADMIN_ACCESS_TOKEN>
UPSTREAM_PASSWORD=<credencial_backend>
UPSTREAM_URL=https://<novo_dominio_do_backend>
UPSTREAM_USERNAME=<usuario_backend>
```

A Function verifica a consistência e robustez dos segredos em tempo de execução; não reutilizar tokens publicados ou fracos. Variáveis `RAILWAY_*` são geradas pela plataforma; não copiá-las manualmente.

## Volume e risco de perda permanente

**O volume original NÃO FOI EXPORTADO NESTA CAPTURA.**
- Volume `prospector-persistent-data`, 500 MB, mount `/data`.
- Guardar cópia privada e íntegra do conteúdo de `/data` **antes da exclusão**: banco SQLite (inclusive arquivos WAL/SHM caso existam), sessão Baileys `wa-session/`, mídia, dados de campanha, histórico de abordagens e quaisquer backups locais.
- Preservar permissões dos arquivos; verificar integridade de SQLite e consistência de histórico antes de habilitar novos envios.
- Se não conseguir exportar o volume devido ao trial expirado, preferir reativar a conta existente para extrair os dados. Não tratar GitHub como substituto do volume.
- Guardar segredos anteriores num cofre privado; não anexar a um repositório público. Recriar/rotacionar credenciais de acesso no novo Railway.

## Regras operacionais pretendidas (exigem conferência no SQLite restaurado)

- Descoberta automática a partir de **05h00**, alvo de **150 leads únicos/dia**, com deduplicação e contadores reais.
- Busca OSM/Overpass: máximo de **12 consultas/dia**, intervalo mínimo **45 minutos**; tratar timeout, backoff e erros. Não contornar restrições do serviço.
- Janela comercial: **08h00–18h00** America/Sao_Paulo; máximo **150 abordagens/dia**, cadência desejada aproximadamente **240 segundos** entre mensagens iniciais.
- WhatsApp via **Baileys** conectado por QR e sessão persistida; não assumir que a sessão antiga será reutilizável.
- Não abordar automaticamente um lead apenas porque o telefone é público; preservar regras de autorização, opt-out, supressão e histórico.
- Jobs `UNKNOWN`/`SENDING`: **nunca reenviar automaticamente**; revisão de histórico primeiro.
- Campanha de site profissional **R$ 350**; texto inicial personalizado; aguardar resposta e aceite antes de enviar áudio; **45 segundos** antes do áudio, **10 segundos** até o vídeo sem som; interesse → Kanban.
- Manter workflows editáveis e mídia validada. Pacote de campanha em `bridge/campaigns/consecom-350.json` contém metadados e checksums, não os binários.
- As metas e os horários deste documento são **requisitos da operação**, não leituras ao vivo de `settings`. Configurações efetivas da campanha e da fila estão no SQLite ainda não exportado.

## Ordem de reconstrução (após nova conta conectada)

1. Não excluir a conta antiga até garantir backup/restauração de dados ou aceitar conscientemente a perda.
2. Criar projeto `prospector-consecom` e ambiente `production`.
3. Criar volume `prospector-persistent-data` (capacidade compatível), vincular ao backend em `/data`.
4. Conectar GitHub `WmAgencia/Prospector` na branch `main`; revisar PRs pendentes e testes antes de implantar.
5. Implantar `prospector-operacional` com comando, health check e variáveis necessários; deixar envios pausados até validação.
6. Importar conteúdo do volume restaurado antes de reativar filas. Se não existir backup, inicializar dados novos com ciência da perda do histórico e nunca pressupor que abordagens anteriores não ocorreram.
7. Criar `prospector-ui` como Railway Function Bun; colar código em `infra/railway/prospector-ui.ts`; configurar variáveis seguras com novo domínio do backend.
8. Testar `/health`, autenticação do gateway, chamadas API privadas, persistência SQLite, sessão WhatsApp, status da fila, campanha e mídia; validar logs.
9. Executar testes de descoberta com fonte pública e tratamento de erro, verificando leads realmente novos.
10. Somente após revalidar contatos elegíveis, histórico de envios, opt-in e regras de cadência, liberar testes WhatsApp para números de teste autorizados e, depois, operação comercial.

## Diagnóstico anterior (histórico de 19/10/2026, não atual)

- 71 empresas no banco; 56 em Encontrados, das quais 52 sem telefone; 4 com telefone; nenhum contato novo elegível; 4 resultados de envio incertos.
- OSM havia consumido 12 consultas no dia e registrava `PROVIDER_LIMIT`, sem leads novos nesse dia.
- Ambos os serviços ficaram sem deployments ativos, e redeploy falhou com `Your trial has expired`.
- Pull request da melhoria OSM: https://github.com/WmAgencia/Prospector/pull/21 (verificar estado antes de novo deploy).

## Checklist de segurança

- [ ] Volume anterior exportado e cópia testada
- [ ] Credenciais importantes guardadas fora do GitHub
- [ ] Código gateway `prospector-ui.ts` preservado no repositório
- [ ] Banco importado e deduplicação verificada
- [ ] Novas variáveis de ambiente e URLs ajustadas
- [ ] Testes GitHub e health check passando
- [ ] WhatsApp real conectado, sem duplicação de envios
- [ ] Fila e campanha conferidas antes de despausar

**Importante:** recriar uma conta com o mesmo e-mail não garante reativação do período de teste, nem preservação de projeto, domínio, volume ou credenciais anteriores.
