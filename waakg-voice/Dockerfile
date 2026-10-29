# WA-AKG original application + native VoIP adapter built reproducibly from exact commits.
# Does NOT create another WhatsApp socket or use a separate auth database.
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates openssl libc6 libstdc++6 libnss3 libglib2.0-0 libx11-6 libxext6 libasound2 libgbm1 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/mrifqidaffaaditya/WA-AKG.git /app \
 && cd /app && git checkout 40dc3f14b51bdc9e7b0ad96003594adeabb85b34
RUN git clone --depth 1 https://github.com/paulohsilvestre/wa-node-call-ba.git /tmp/voice-source \
 && cd /tmp/voice-source && git checkout f9db8e52f8c0d915f1a1c29f009506e7ec2bf02c
WORKDIR /app
COPY voice-calls.ts ./src/modules/whatsapp/voice-calls.ts
COPY patch.py /tmp/patch.py
RUN mkdir -p src/voice-protocol \
 && cp -R /tmp/voice-source/src src/voice-protocol/ \
 && cp -R /tmp/voice-source/native src/voice-protocol/ \
 && python3 /tmp/patch.py
RUN npm ci --legacy-peer-deps \
 && npm install --save-exact --legacy-peer-deps baileys@7.0.0-rc12 @roamhq/wrtc@0.8.0 koffi@2.12.0 @evan/opus@1.0.3 fluent-ffmpeg@2.1.3
RUN npx prisma generate && npm run build
RUN npm prune --omit=dev && npm install --no-save tsx typescript

FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libnss3 libglib2.0-0 libx11-6 libxext6 libasound2 libgbm1 libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/scripts ./scripts
RUN mkdir -p /app/data/media /app/data/auth && chown -R node:node /app/data
USER node
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && (if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
