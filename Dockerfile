FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PROSPECTOR_DATA_DIR=/data
ENV PROSPECTOR_SESSION_DIR=/data/wa-session
EXPOSE 3000
CMD ["node","dashboard/server.mjs"]
