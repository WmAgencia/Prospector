FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates git && rm -rf /var/lib/apt/lists/*
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
