# Backend real do Prospector na Railway

- Serviço dedicado com repositório GitHub, start Node.js 22 via Dockerfile, uma réplica.
- Montar volume persistente em /data; nele ficam SQLite, mídia e sessão WhatsApp.
- Configurar PORT=3000, PROSPECTOR_DATA_DIR=/data, PROSPECTOR_SESSION_DIR=/data/wa-session, NODE_ENV=production.
- ADMIN_USERNAME e ADMIN_PASSWORD secretos são obrigatórios em produção. Senha mínima de 20 caracteres. Não colocar no GitHub.
- Gerar domínio HTTPS. /health é público e minimalista. Todo o restante usa autenticação HTTP Basic, sem acesso anônimo.
- Configurar APP_BASE_URL como o endereço HTTPS do serviço protegido para notificações com link do card.
- STUDIO_SYNC_ENABLED=1 sincroniza amostras publicadas no GitHub pelo ChatGPT, sem API separada.
- A prospecção permanece pausada por padrão e o WhatsApp desconectado até você ler o QR Code.
- Não compartilhe credenciais e não conecte a mesma sessão de WhatsApp em dois processos.
- Serviço Railway 'prospector-ui' permanece demonstração fictícia, separado do backend operacional.
- Upload de vídeo requer ffprobe, incluído no Dockerfile.
- Para usar em produção com equipes, considerar autenticação individual, backups regulares, LGPD e API oficial do WhatsApp.
