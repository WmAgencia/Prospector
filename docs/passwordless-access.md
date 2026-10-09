# Acesso sem usuário ou senha
O Prospector usa link privado com token no fragmento da URL, troca por cookie HttpOnly Secure SameSite=Strict.
A sessão dura 90 dias. O navegador apaga o fragmento após o primeiro acesso.
Variáveis obrigatórias em produção: ADMIN_ACCESS_TOKEN e ADMIN_SESSION_SECRET com 40 ou mais caracteres.
ADMIN_USERNAME e ADMIN_PASSWORD são legadas e não são consultadas.
Rotas operacionais são privadas, /health é público sem detalhes, /access mostra a tela de validação, /api/auth/exchange troca a posse do link por sessão.
O link é uma credencial: não compartilhe. Rotacione ambas as variáveis se o link vazar.
A prévia pública continua isolada do painel operacional. Para futuro multiusuário, usar OAuth ou Cloudflare Access.
