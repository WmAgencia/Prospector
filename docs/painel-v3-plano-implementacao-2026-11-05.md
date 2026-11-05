# Prospector v3 — plano de implementação e rollout

Data: 2026-11-05. A landing aprovada permanece intacta. Implementação na PR #113, ainda não publicada em produção.

## Interfaces

- Visão geral: remover aviso grande de desconexão; manter status curto no cabeçalho e botão Conectar.
- Conversas: ajustar lista, cabeçalho, mensagens e composer ao padrão visual do WhatsApp Web; manter Assumir conversa e Entregar para IA.
- Prospecção: escolher modo all, niche-all, niche-city ou all-city; salvar descoberta automática com consentimento explícito de ativação; calendário mensal com empresas abordadas e vendas confirmadas, navegação e detalhes por dia.
- Conexões: lista nomeada de WhatsApps, QR individual em modal com desfoque, estado de conexão e fechamento automático em 2,5 segundos.
- Treinamento: assistente de quatro etapas (empresa, texto/áudio, seleção/análise autorizada de conversas, aprovação); após configurar, chat e perfil em duas colunas.
- Créditos: mantém carteira e catálogo atuais; conta interna Consecom ilimitada.
- Configurações: período de novas abordagens restrito às 8h–17h30, e-mail/senha com confirmação, pausa da fila.
- Francisca: widget de texto/voz presente no espaço do cliente, com contexto apenas da conta, histórico curto e efêmero, e respostas por voz usando pt-BR-FranciscaNeural.

## Critérios e limites

- Pesquisa geral significa os nichos e cidades cobertos pela fonte atual; não implica pesquisa mundial. OSM possui cotas comunitárias.
- Empresa encontrada não implica autorização para enviar WhatsApp. Regras de opt-in, cadência e limites continuam obrigatórias.
- O calendário só usa status SENT e CLOSED_WON registrados. A conversão é a proporção das empresas abordadas em um dia que têm venda confirmada, mesmo que tenham fechado depois.
- Quando falta carimbo exato de envio, a data do cadastro original é considerada aproximada e sinalizada.
- A Francisca é somente leitura. Ainda não executa ações, não lê outras contas e não promete áudio full-duplex/streaming contínuo; o diálogo é por turnos, com interrupção local da reprodução.
- Textos do treinamento são editáveis antes de ativar perfil; a seleção de todas as conversas exige autorização expressa.
- Mudança de e-mail/senha invalida sessões anteriores, com novo cookie para o navegador atual.

## Publicação segura

1. Confirmar testes de CI, smoke de API e segurança por tenant.
2. Realizar testes interativos de QR, dois WhatsApps, microfone, TTS, calendário e troca de senha com uma conta de teste.
3. Revisar disponibilidade real dos provedores de áudio no Railway e variáveis dos trabalhadores isolados.
4. Publicar gradualmente, preservar dados e volume persistente, e conferir logs de inicialização/saúde.
5. Não modificar a política de autorização de envios, os limites do canal ou a landing aprovada.

Critério de aceite: nenhuma conta acessa o contexto de outra, não há envio pela Francisca, as vendas não são inventadas e todas as configurações essenciais permanecem funcionalmente acessíveis em mobile.
