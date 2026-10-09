# Automações condicionais sem IA — Prospector Consecom

## Editor

O menu **Automações** substitui Workflows. Crie quantos fluxos quiser, com:
- Nome, estado ativado/desativado e lista de segmentos (nomes normalizados e sem distinção de maiúsculas ou acentos).
- Blocos de texto, imagem, áudio, vídeo, atraso, aguardar resposta, decisão e fim.
- Para cada áudio, preencha a **descrição do que ele diz**. Esse texto é metadado configurado pelo operador, não reconhecimento de fala.
- Um bloco **Decisão** deve seguir imediatamente **Aguardar resposta**. Ele registra a pergunta anterior e o contexto (`sample_offer` ou `general_interest`), com resposta de texto ou áudio para SIM/NÃO e ação para cada resultado.
- Respostas não classificadas como afirmativas ou negativas deixam a execução em `NEEDS_REVIEW` e não disparam mídias automaticamente.
- O simulador do editor classifica frases sem enviar nada.

## Execução

A seleção da automação é determinística: primeiro correspondência exata e normalizada do segmento; em empate ordena pelo nome/ID; se não há correspondência usa a automação padrão ativa. Também é possível escolher manualmente uma automação no card do lead. O envio depende da autorização do contato e não altera a regra de uma primeira abordagem por lead.

A classificação considera **a pergunta pendente naquele fluxo**, não mensagens soltas. Recusas explícitas e opt-outs ganham prioridade. No contexto oferta de site:

- Resposta afirmativa: envia a resposta configurada, marca o lead como interessado, cria uma solicitação de prévia no Kanban Produção, interrompe outros disparos do fluxo e gera notificação ao responsável. Prazo de 10 minutos é **meta**, não garantia.
- Resposta negativa: envia uma única mensagem de encerramento se configurada, marca sem interesse e encerra o fluxo. Não há mensagem comercial de sequência.
- Resposta ambígua, áudio recebido sem transcrição ou incerteza: pausa para revisão humana; não inventa intenção de compra.
- Pedido explícito para parar de contatar: suprime o contato sem mensagem adicional.

## Produção e entrega

No Kanban **Produção**, abra a demanda, copie o briefing e cole em qualquer conversa do ChatGPT. A criação não usa API de modelo no backend. Publique a landing no GitHub e vincule `production_ref`. Uma vez pronta, **somente a aprovação humana** enfileira o link para envio WhatsApp.

### Observações

Mídias/áudios devem existir na biblioteca antes de salvar o fluxo. Fluxos iniciados guardam snapshot da versão de seus blocos; edições novas não alteram execuções em andamento. A configuração continua SQLite local e o Railway público contém **somente uma prévia fictícia**. Antes de publicar o backend real na web, é obrigatório implementar autenticação, armazenamento persistente e realizar testes com uma conta WhatsApp de demonstração. Não desative salvaguardas contra spam.
