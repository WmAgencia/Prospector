# Ponte de IA — Prospector Consecom

Esta pasta contém um **contrato de tarefas para IAs**. Qualquer IA conectada ao GitHub com acesso para escrever no repositório pode atualizar a configuração da campanha sem conhecer o banco de produção ou os segredos do Railway.

## Fluxo (sem acesso ao PC ou execução de shell no Railway)

1. A IA altera **somente** `bridge/campaigns/consecom-350.json` em um branch/PR; depois que uma alteração autorizada chega à `main`, o Prospector lê o manifesto por HTTPS e reconcilia a campanha.
2. O backend valida esquema, horários, limites, ações finais e os hashes SHA-256 do áudio e vídeo.
3. Cria/atualiza um **único** workflow com o roteiro informado, mantendo IDs, registros de mídia já existentes e execuções anteriores.
4. Se áudio ou vídeo ainda não estão na biblioteca privada, o estado é `WAITING_MEDIA` e o workflow fica **desativado**. Nenhum envio é liberado. O manifesto **não inclui nem expõe os arquivos**.
5. Para completar a importação, a IA com acesso à sessão autenticada do Prospector e aos bytes do arquivo pode enviar o ZIP pelo endpoint autenticado `POST /api/campaign/import-package` (Content-Type: application/zip) ou enviar mídia individual via `POST /api/media?kind=audio&name=...` e `POST /api/media?kind=video&name=...`. O backend reconcilia novamente assim que os arquivos são verificados pelo hash.
6. A IA verifica `GET /api/agent-bridge/status`, e pode acionar `POST /api/agent-bridge/sync`, ambos **exigem autenticação de administrador já existente**. Resposta pronta: `READY`. Pendente: `WAITING_MEDIA`. Há logs de revisão quando uma etapa falha.
7. Quando ambas as mídias forem importadas, o workflow fica pronto. **A ponte não retoma a operação e não dispara mensagens**. A primeira abordagem continua exigindo a permissão registrada do contato.

A ponte não permite SQL arbitrário, cadastro de consentimento, alteração do limite de envios ou execução de código remoto. Para modificar um fluxo, altere e revise o JSON do manifesto, não use conteúdo executável. **Nunca inclua tokens, links privados ou arquivos de clientes neste repositório público.**

Campanha e arquivos esperados:

- Abordagem: `Olá, {{first_name}}. Tudo bem? A gente conheceu o trabalho de vocês e gostaríamos de apresentar uma proposta. Posso te enviar um áudio explicando tudo certinho?` (o token real do app é `{{greeting}}`, com fallback `Olá, tudo bem?`)
- Resposta: aguardar autorização clara.
- Espera: 45 segundos → áudio OGG/Opus do Wesley → espera 10 segundos → vídeo MP4 sem som, com legenda `O que achou? Gostaria de ter um assim também?`.
- Resposta de interesse: mover para **Interessados** e assumir manualmente.
- Recusa: responder `Sem problemas, muito obrigado pelo retorno, ficamos à disposição.` (salvo opt-out), mover para **Sem interesse**.
- Limites operacionais: até 150 primeiras abordagens/dia; janela 08h–18h São Paulo. Configurações e estado de pausa permanecem sob controle do operador.

## Segurança operacional

- O conteúdo do manifesto é público, mas **as mídias e credenciais não são**.
- Uma nova configuração pode ser entregue via GitHub; **o upload de arquivos binários exige acesso autenticado do operador ou de uma IA que tenha esse acesso**. Apenas escrever o manifesto **não** transfere MP4/OGG.
- Não gere autorização de contatos a partir da descoberta pública.
- O processamento deve ser idempotente, com leitura por hash e registro do último resultado.