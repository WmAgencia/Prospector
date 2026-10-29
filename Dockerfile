FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates git python3 python3-venv && rm -rf /var/lib/apt/lists/*
# Dedicated Python venv for Francisca TTS; no third-party service credentials stored in image.
RUN python3 -m venv /opt/francisca && /opt/francisca/bin/pip install --no-cache-dir edge-tts==7.3.0
WORKDIR /app
COPY package.json package-lock.json ./
# Use the exact dependency set tested locally and in CI.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:" \
 && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PROSPECTOR_DATA_DIR=/data
ENV PROSPECTOR_SESSION_DIR=/data/wa-session
EXPOSE 3000
CMD ["node","dashboard/server.mjs"]
