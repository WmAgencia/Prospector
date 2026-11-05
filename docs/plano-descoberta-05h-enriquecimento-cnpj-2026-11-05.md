# Prospector — pesquisa às 05h e enriquecimento CNPJ

Data: 2026-11-05. Documento de investigação/arquitetura; **não implica API contratada, integração CNPJ implantada nem alteração da operação em produção**.

## Decisão de agenda (America/Sao_Paulo)

- **05:00–06:30**: descoberta e deduplicação, respeitando limites do OSM, sem mensagens.
- **06:30–07:30**: identificação de CNPJ e validação de correspondências; verificar situação cadastral, atividade e contatos do estabelecimento quando a fonte permitir.
- **07:30–08:00**: classificação e pré-preparo da fila; somente registros com permissão/documentação adequada podem ser considerados para envio.
- **08:00–17:30**: janela existente de novas abordagens elegíveis (não mudar sem validar políticas do canal). A pesquisa pode continuar após 08:00 quando houver orçamento de fonte.
- Fuso de referência: `America/Sao_Paulo`. Na virada do dia, a data local é a unidade do limite diário. Nunca usar `05:00Z` como se fosse 05h local.
- Sem automação de mensagens às 05h. Nenhuma alteração de permissão por enriquecimento de dados.

## Estado observado no código

- `dashboard/osm-discovery.mjs`: `DISCOVERY_START_HOUR=5` e `discoveryWindow` respeitam `discovery_start_hour`; o timer no `dashboard/server.mjs` executa `dailyLocalDiscovery` a cada 60 segundos.
- `dashboard/db.mjs`: inicialização/migração `discovery_5am_outreach_8am_v1` define 5h; configuração armazenada pode ser alterada e precisa ser conferida em produção.
- O agendamento de preparo antecipado de abordagens frias ainda começa às 07h no `autonomousQueueTimer`, e as abordagens novas têm janela 08:00–17:30 em `dashboard/outreach-window.mjs`.
- OSM: no máximo 12 pesquisas automáticas por dia, cooldown de 45 min; portanto, de 05:00 até antes de 08:00 cabem, em condições ideais, cerca de 4 chamadas (05:00, 05:45, 06:30 e 07:15). Não prometer 250 leads somente nesse intervalo.
- O projeto contém `tests/discovery-5am-goal.test.mjs` com validação da janela das 05h. Isso comprova comportamento do código, não que a configuração/worker esteja ativo na produção.
- `dashboard/official-import.mjs` já importa registros de CNPJ fornecidos pelo operador, mas a descoberta em tempo real de CNPJ por nome não está conectada; a validação atual exige 14 dígitos numéricos e precisa suportar CNPJ alfanumérico.
- Dados principais ainda usam SQLite; a fase multi-tenant exige escopo por tenant e autorização em backend antes de processar dados de clientes.

## Estratégia de enriquecimento proposta

1. Receber estabelecimento localizado por uma fonte cuja licença permita o tratamento/armazenamento previstos.
2. Normalizar nome fantasia/razão social, município, UF, endereço e CEP; conferir se o site empresarial informa o CNPJ de maneira legítima.
3. Buscar CNPJ por `nome` + `municipio` (IBGE 7 dígitos) + `uf` quando houver autorização de fornecedor; não usar correspondência parcial de nome isoladamente.
4. Conferir correspondência determinística: razão social/nome fantasia, localização, CEP/endereço e CNAE; se houver homônimos, deixar para revisão. Matriz/filial devem ser identificadas corretamente.
5. Consultar `full` só para candidatos confiáveis. O cadastro da Receita fornece contatos do estabelecimento; QSA identifica sócios, mas **não fornece o celular pessoal de cada sócio**.
6. Guardar múltiplos candidatos de contatos institucionais com `source`, `observed_at`, `data_as_of`, `confidence`, `tenant_id` e `contact_permission` independente; não sobrescrever nem reatribuir histórico ao trocar um telefone.
7. Contato selecionado: canal corporativo confirmado e permitido; caso a consulta de CNPJ não encontre um número comercial confiável, usar o número comercial encontrado no OSM, quando apropriado. Não procurar telefone pessoal de sócios por cruzamento de bases.
8. Não executar disparos automáticos para contatos públicos sem os requisitos de consentimento/permissão do canal; não confundir lista empresarial com opt-in de WhatsApp.
9. Respeitar `meta.suppressed` do fornecedor: não tentar recuperar por outra fonte o que foi removido a pedido do titular.
10. Custos, erros e dados devem ser isolados por tenant, com fila idempotente e limite monetário de consultas.

## Opções de origem e custos, verificadas em 05/11/2026

### Dados públicos e oficiais

- Receita Federal: dados cadastrais/QSA públicos e documentação em https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos
- Serpro / serviço público de API CNPJ (consulta por número, não buscador livre por nome): https://www.gov.br/pt-br/servicos/obter-solucao-de-consulta-de-dados-do-cadastro-nacional-de-pessoas-juridicas-cnpj
- O formato CNPJ alfanumérico entrou em operação em julho/2026: https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/julho/receita-federal-gera-o-primeiro-cnpj-em-formato-alfanumerico

### Fornecedor de busca por nome: cnpj.ia.br

- Documentação: https://cnpj.ia.br/docs/busca-empresas
- Preços: https://cnpj.ia.br/precos
- Dados e frescor: https://cnpj.ia.br/docs/dados-e-frescor
- Uso aceitável: https://cnpj.ia.br/docs/privacidade-e-uso-aceitavel
- Preço de referência na consulta pública: Starter R$49/15.000 créditos mensais; 1 crédito por empresa retornada na busca; 6 por consulta `full` (apenas sucesso debitado). Essas tarifas podem mudar.
- Na hipótese de **uma** empresa retornada na busca e uma consulta full para cada um de 250 leads: 250 × 7 = 1.750 créditos; equivalente a R$5,72 se a franquia Starter for totalmente utilizada. Uma busca ambígua com várias empresas retornadas custa mais; isso não inclui despesas fixas, IA nem canais.
- Rate limit Starter: 30 requisições/minuto (por conta). Em `429`, seguir `Retry-After`. Datas dos cadastros são mensais: respeitar `meta.data_as_of`.
- Dados extras publicados no nível da **raiz** do CNPJ podem incluir outras filiais; não atribuir automaticamente um número extra à filial certa.
- Contrato/licença e regras de armazenamento devem ser confirmados antes da integração paga.

### Google Places

- O identificador `place_id` pode ser armazenado; os demais campos têm restrições de cache e uso. Não construir base persistente copiando resultados sem observar as condições de Google Maps Platform.
- Políticas: https://developers.google.com/maps/documentation/places/web-service/policies
- Preferir OSM para cadastro persistente e Google apenas na modalidade permitida, conforme licenças.

### LGPD

- Tratamento de dados pessoais de sócios deve ter base legal e teste de necessidade/balanceamento; divulgar nome no QSA não autoriza mensagens não solicitadas.
- Guia ANPD: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse

## Plano de implementação (não executado por este documento)

1. Migrar o cadastro de lead para distinguir empresa (CNPJ/filial) de seus vários contatos e preservar todas as fontes com proveniência.
2. Adicionar serviço de fornecedor com chaves apenas no backend, budget por tenant e cache permitido, com retry/backoff.
3. Criar rotina de correspondência com resultado `MATCHED`, `AMBIGUOUS`, `NOT_FOUND`, `SUPPRESSED`, `SOURCE_ERROR`.
4. Adicionar fila incremental para enriquecimento sem segurar o worker de descoberta; somente consultar `full` candidatos validados.
5. Medir custo por candidato, porcentagem de empresas corretamente identificadas, telefones institucionais novos, fontes com erro e tempo de execução.
6. Testes: colisão homônima, matriz/filial, CNPJ alfanumérico, falta de telefone, opt-out, supressão e fronteiras 04:59/05:00/07:59/08:00.
7. Ativar inicialmente em modo observação (sem mensagens), validar resultado com casos reais revisados e somente depois publicar.

**Operacional:** A possibilidade de 250 novas abordagens por dia é um objetivo comercial, não um limite seguro garantido pela Meta/WhatsApp nem uma capacidade assegurada pelas cotas do OSM. O canal, o consentimento e o custo precisam ser verificados independentemente.
