FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-impress libreoffice-calc \
      fonts-liberation fonts-dejavu fonts-noto-core fonts-noto-ui-core fonts-noto-extra fonts-freefont-ttf \
      fonts-opensymbol \
    && (apt-get install -y --no-install-recommends culmus || true) \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
