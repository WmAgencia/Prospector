# Operação real e permissões

O Prospector separa **descoberta de empresas** de **autorização para abordar**. Fontes públicas, incluindo OpenStreetMap, não são consentimento para receber propaganda. Todo lead descoberto começa com `contact_permission=0`, sem envios ou confirmação implícita de ausência de site.

## Descoberta pública sem chave

`dashboard/osm-discovery.mjs` oferece pesquisa local para Sorocaba, Votorantim, Campinas e São Paulo em segmentos pré-definidos. Usa a API comunitária Overpass de forma limitada: até 70 elementos por consulta, no máximo 8 buscas registradas por dia, cache manual por 45 minutos e uma única consulta automática por dia. Pode ser desativada em Configurações. Sem garantia de disponibilidade, telefone, cobertura completa ou existência de site. Não escala como coletor contínuo; para produção em volume é preciso hospedar extrato OpenStreetMap ou contratar um provedor licenciado.

Atribuição: © OpenStreetMap contributors (ODbL). https://www.openstreetmap.org/copyright

Brave, Google Places e WhatsApp Cloud API são serviços distintos. Repositórios GitHub não substituem chaves, contratos ou autorizações dos provedores.

## Mensagens

O motor processa fila apenas com WhatsApp efetivamente **CONNECTED**, prospecção despausada, horário permitido, limites por dia e regras de opt-out. Contato inicial exige `contact_permission=1`, telefone válido, workflow ativo e ausência de primeira abordagem registrada.

`auto_initial` só deve ser ativado após revisão explícita do cadastro consentido. A plataforma não envia mensagens para empresas recém-coletadas automaticamente. Não alterar os controles para contornar a ausência de permissão.

Baileys não é a API oficial do WhatsApp. O pareamento via QR no dispositivo precisa de ação do proprietário, e bloqueios ou restrições do WhatsApp não podem ser removidos pelo sistema.

## Validação operacional

Testar: ligação ao backend; resposta do Overpass; registro de lead e deduplicação; QR; WhatsApp conectado; mensagem real para número de teste sob seu controle e confirmado; resposta ao fluxo; produção do site; aprovação antes de enviar ao contato. Sucesso em testes de API não equivale a confirmação de entrega pelo WhatsApp.
