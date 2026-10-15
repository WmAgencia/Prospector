FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# A linha 7.0.0-rc14 pode rejeitar o primeiro login pós-QR com HTTP 401.
# A 6.7.23 concluiu esse ciclo no mesmo ambiente (WhiskeySockets/Baileys#2248).
# Instalação fixada no contêiner, enquanto o lockfile legada ainda é usada no CI.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:" \
 && npm install --no-save --omit=dev --no-audit --no-fund @whiskeysockets/baileys@6.7.23 \
 && node -e "const p=require('./node_modules/@whiskeysockets/baileys/package.json');if(p.version!=='6.7.23')process.exit(2);console.log('Baileys runtime version',p.version)"
COPY . .
ENV NODE_ENV=production
ENV PROSPECTOR_DATA_DIR=/data
ENV PROSPECTOR_SESSION_DIR=/data/wa-session
EXPOSE 3000
CMD ["node","dashboard/server.mjs"]
