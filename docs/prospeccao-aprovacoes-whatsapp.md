# Prospecção e aprovação pelo WhatsApp

## Operação

1. Na guia Prospecção, informe o ramo e a cidade e clique Pesquisar. Quando configurado, o Google Maps é a fonte principal. A tarefa é assíncrona; ao terminar os resultados são salvos e a lista atualizada. Se Maps não estiver configurado, a tela informa o uso de OpenStreetMap. Nenhuma fonte garante todas as empresas existentes ou WhatsApp válido.
2. Escolha a abordagem: portfólio, promoção ou empresa maior. Selecione as empresas desejadas ou todas da lista carregada. A lista exibe até 1000 registros elegíveis; refine a pesquisa se necessário.
3. Clique Abordar. Esse clique aprova somente os registros selecionados. A fila envia uma saudação com o nome e o período do dia de São Paulo, com intervalo persistente de 90 segundos entre contatos. Não altera o campo de consentimento do destinatário.
4. Após a resposta vem a apresentação e a continuidade com Groq. Perguntas de preço já na primeira resposta chegam diretamente à aprovação. Sem resposta não existe sequência de insistência. Cancelar fila não tenta reenviar entregas incertas.

Empresas apenas visualizadas permanecem disponíveis em buscas futuras. Contatos já abordados seguem o prazo de recontato. Clientes existentes, proprietário, contatos bloqueados e conversas assumidas manualmente não entram em novas abordagens.

## Propostas

Cada pedido de preço cria uma aprovação vinculada à empresa e à mensagem do cliente. O WhatsApp pessoal final7336 recebe a empresa, telefone, pergunta, links reais disponíveis e as escolhas:

| Oferta | Valor | Início | Entrega |
| --- | --- | --- | --- |
| Portfólio | R$350 | R$175 | R$175 |
| Promoção | R$550 | R$275 | R$275 |
| Empresa maior | R$1500 | R$750 | R$750 |

Prazo mínimo de quatro dias, com prazo final conforme escopo. O Groq não envia a antiga referência automática de R$550, desconto de80% nem promessa de três dias. A proposta é composta pelo servidor com o valor escolhido, não inventada pelo modelo.

Os botões são acompanhados de uma mensagem com links para confirmar a escolha no WhatsApp comercial. Se o aparelho não exibir botões nativos, o link abre o comando; é necessário enviá-lo pelo WhatsApp pessoal autorizado. Apenas o número completo do proprietário na sessão correta pode aprovar. Links encaminhados a terceiros não dão permissão. As opções Recusar e Assumir também estão nos links.

Uma escolha é usada uma vez. Pedidos expiram em24horas. Uma mensagem posterior do cliente, bloqueio ou atendimento humano invalidam uma aprovação desatualizada. Resultado de envio incerto fica para revisão e não é repetido automaticamente.

## Interessados

O alerta inclui empresa, contato, telefone e links disponíveis. O link `wa.me` abre diretamente a conversa do prospect. Quando o interesse é confirmado, a IA passa a conversa para atendimento humano. Perguntar preço, por si só, não significa venda ou interesse confirmado.

## Configuração

- Manter Groq configurado; MCP desativado.
- `PROSPECTOR_OWNER_PHONE`, `PROSPECTOR_PERSONAL_PHONE` e `PROSPECTOR_HOT_LEAD_PHONE`: número completo autorizado final7336.
- `PROSPECTOR_LIVE_TEST_ENABLED=false` na operação normal: o proprietário precisa receber decisões administrativas, não ser tratado como contato de teste.
- A sessão WA-AKG precisa estar conectada, com webhook `message.received` autenticado. A seleção dos botões chega como conteúdo do evento do gateway.
- O demo opcional usa `PROSPECTOR_OWNER_APPROVAL_DEMO_ENABLED=true` e um UUID em `PROSPECTOR_OWNER_APPROVAL_DEMO_ID`. Ele envia somente ao proprietário e confirma a escolha sem enviar proposta a qualquer empresa. Reservas impedem repetição após reinício; desativar o flag ao concluir.

## Verificação

Testes cobrem mais de100 selecionados, mais de500 resultados visíveis, três conversas simultâneas com preços diferentes, prazo/parcelas, primeira resposta pedindo preço, alterações de escopo, duplicação, expiração, opt-out, sessão divergente e aprovador incorreto. O Chrome valida a pesquisa Maps, importação, seleção e Abordar com APIs simuladas; não envia mensagens reais.

Validação da entrega: 298 testes aprovados, revisão independente concluída após corrigir a rejeição de valores por extenso e promessas de condições não aprovadas. Sintaxe dos módulos e teste Chrome desktop/móvel aprovados. A confirmação de botões/links no aparelho é registrada separadamente após publicação.
