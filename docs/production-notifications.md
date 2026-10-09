# Produção de sites e notificações

A nova aba Produção concentra pedidos aceitos, criação no ChatGPT, páginas prontas para revisão, mensagens enfileiradas e entregues.

## Procedimento

1. O cliente pede explicitamente um exemplo de site ou aceita um áudio de oferta registrado no sistema.
2. Um card REQUESTED é criado, com takeover humano. A notificação do responsável fica na fila.
3. Clique no card, copie o briefing e cole em qualquer chat ChatGPT.
4. Ao terminar, publique a página em studio/sites/SLUG.html e cadastre em studio/projects.json o campo production_ref igual ao job_reference copiado no briefing.
5. Com STUDIO_SYNC_ENABLED=1, o backend consulta o catálogo a cada minuto, marca READY e notifica o responsável. Também é possível colar manualmente o link no card.
6. Confira a landing e exportação PDF. Só depois clique em Aprovar e enviar. O sistema coloca a mensagem na fila e confirma entrega pelo WhatsApp quando conectado e habilitado.
7. Marque fechamento somente após confirmação comercial.

## Configuração do responsável

Configurações permite definir dois números brasileiros completos. Se A está conectado, envia para B; se B está conectado, envia para A. Caso a sessão não corresponda a nenhum deles, nenhum aviso é enviado. O relatório diário é programado para 20h em America/Sao_Paulo. É necessário que o backend esteja em execução e o WhatsApp conectado; avisos na fila aguardam conexão.

APP_BASE_URL define o link direto para o card na notificação. Sem essa variável, o link é localhost e só funciona no computador do backend. NÃO publique esse backend administrativo sem autenticação e banco persistente apropriado. A Railway atual é somente preview fictício e NÃO é o painel real.

STUDIO_SYNC_ENABLED=1 ativa consulta ao manifesto público do GitHub. Nenhuma API de IA é necessária porque a criação ocorre manualmente na conversa. O prazo de 10 minutos é apenas meta operacional.

## Segurança

Os telefones do proprietário são armazenados no banco local, não no GitHub. Não crie envios se os números ainda não estiverem verificados. Opt-outs cancelam solicitações pendentes. Envios cuja confirmação é desconhecida nunca são reenviados automaticamente. WhatsApp via Baileys é não oficial. Não publicar dados privados dos leads em studio/projects.json.
