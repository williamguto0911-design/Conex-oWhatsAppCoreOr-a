FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y chromium fonts-liberation --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 3000
CMD ["npm","start"]
