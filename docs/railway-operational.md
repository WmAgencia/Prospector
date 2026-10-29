# Prospector — operação Railway (revisado em 29/10/2026)

A fonte de verdade da infraestrutura é [infraestrutura.md](infraestrutura.md). A conexão Railway correta no ChatGPT é **`paidogame`** e o projeto é **`prospector-consecom`** (`e19a1205-b641-47a5-a949-675e968e11ad`). Uma conexão antiga rotulada `Prospector` aponta para conta excluída; não usá-la para operações.

## Serviços
1. **prospector-operacional**: `WmAgencia/Prospector` (`main`), Node.js, início `node dashboard/server.mjs`, porta 3000, `/health`, volume `/data` com SQLite e dados persistentes.
2. **prospector-ui**: Railway Function Bun, interface privada com sessão de acesso e proxy para o backend; não é prévia fictícia.
3. **wa-akg**: gateway WhatsApp persistente, com volume `/app/data`; usa sessão WhatsApp selecionada e webhook autenticado.
4. **wa-akg-mysql**: MySQL do gateway, volume `/var/lib/mysql`.

A interface de entrada é `https://prospector-ui-production.up.railway.app`; o backend tem domínio separado `https://prospector-operacional-production.up.railway.app`. Manter endpoints administrativos autenticados, sessão privada e configuração de segredos na Railway; não publicar credenciais no GitHub.

## Verificação e lançamento
- Verifique na Railway `production` que todos os serviços estão em `SUCCESS`, sem mudanças pendentes, com volumes montados e healthcheck do backend aprovado.
- Confira GitHub Actions `Tests and API smoke` e `Production access security smoke` para o commit exato que foi publicado.
- Preserve `PROSPECTOR_OWNER_PHONE` como identificador exato do proprietário; telefones de aviso e de teste não concedem privilégios. Classifique clientes existentes com evidência administrativa.
- Confira autenticação do webhook, identidade `s.whatsapp.net` da sessão real, atendimento ao cliente existente e não divulgação de ferramentas do owner a contatos comuns.
- Teste texto, áudio, transcrição e alertas ao proprietário em um número autorizado, sem ativar disparos em massa.
- A fila comercial deve permanecer pausada até verificação de consentimento, deduplicação e decisão explícita de ativação. Mensagens com entrega incerta não devem ser reenviadas automaticamente.
- Não presuma que o volume de dados antigo foi restaurado na nova instalação; consulte o inventário histórico antes de qualquer migração.

O teste de acesso privado e os testes automatizados do commit `1cd6cb33` concluíram com sucesso em 29/10/2026, e a última implantação do backend também foi `SUCCESS`. Isso não substitui o teste ponta a ponta com WhatsApp real.

## Observações
O código tem SQLite como armazenamento operacional. Migração para Supabase/PostgreSQL depende de projeto separado, backup testado e plano de migração. `FFmpeg/ffprobe` é uma dependência das funções de mídia; conferir a disponibilidade na imagem executada antes de aceitar uploads de vídeo.
