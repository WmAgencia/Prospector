# Laboratório de ligações WhatsApp — Francisca / WA-AKG

**Situação:** protótipo de áudio testado offline; ainda NÃO atende chamadas reais e não modifica o WA-AKG de produção.

## Constatações de 29/10/2026

- Railway wa-akg usa mrifqidaffaaditya/WA-AKG, commit 40dc3f14b51bdc9e7b0ad96003594adeabb85b34.
- Essa versão cria um WASocket em src/modules/whatsapp/instance.ts; não há API exposta para captar ou enviar mídia bidirecional de chamadas.
- O projeto comunitário paulohsilvestre/wa-node-call-ba, revisão fixa f9db8e52f8c0d915f1a1c29f009506e7ec2bf02c, afirma atender chamadas usando MLow/SRTP/WebRTC/SCTP. Não é oficial e sua compatibilidade com nosso número/sessão continua não comprovada.
- O workflow de CI, isolado e sem segredos, testa a compilação e o codec nativo, sem fazer login no WhatsApp.
- O módulo dashboard/francisca-call-lab.mjs reúne áudio PCM16 16k, Whisper/Groq, respostas Groq e sintetização da voz Francisca. Testes simulados não conectam a chamadas.
- A experiência está desligada por padrão (WA_AKG_CALL_LAB_ENABLED=false), sem rota HTTP, sem gravação e sem atendimento automático.

## Próximas etapas obrigatórias para o mesmo número

1. Montar versão experimental do WA-AKG baseada no commit atual. Integrar sinalização e mídia da chamada ao MESMO socket autenticado já utilizado pelo WA-AKG, sem abrir dois processos com credenciais idênticas.
2. Auditar código e licenças do transporte nativo MLow e WebRTC, a criptografia, os relays e a limpeza de recursos.
3. Testar numa sessão isolada pareada por QR e com ligação originada de um telefone físico. Comprovar que o áudio é recebido e enviado, o comportamento de cancelamento, reinício e estabilidade.
4. Ligar o fluxo de áudio recebido ao motor Francisca em turnos; depois implementar VAD/interrupção para conversa genuinamente em tempo real.
5. Quando o transporte estiver comprovado, planejar a migração controlada e com rollback para a sessão real, sem apagar a base/volume atual.
6. Durante os primeiros testes, permitir chamadas apenas do JID completo do proprietário, sem comandos que alterem campanhas ou iniciem prospecção por voz.

## Alternativa de teste sem mexer na sessão existente

Um segundo dispositivo vinculado ao MESMO número, mas com QR e credenciais próprias, pode ser usado para testar o projeto experimental sem reutilizar a sessão WA-AKG. **Não há garantia de roteamento de chamadas para esse dispositivo.** Este teste requer que o proprietário escaneie o QR e faça uma ligação. Nunca reutilizar auth state entre duas instâncias.

## Segurança e limitações

- Sem API oficial da Meta; o protocolo pode mudar e o uso de biblioteca não oficial pode provocar desconexões ou restrições.
- Não entregar uma chamada simulada por mensagens de áudio como se fosse atendimento real.
- Os testes automatizados provam somente funcionalidade local do codec e pipeline de turnos, não o atendimento de chamadas WhatsApp.
- O status de produção permanece inalterado até haver teste de chamada de ponta a ponta e autorização para migração.

Referências: https://github.com/mrifqidaffaaditya/WA-AKG e https://github.com/paulohsilvestre/wa-node-call-ba
