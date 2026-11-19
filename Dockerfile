# Imagen de producción del backend Cyber Tycoon
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instala solo dependencias de producción (aprovecha la caché de capas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY database ./database

# Ejecuta como usuario sin privilegios
USER node

EXPOSE 3000
CMD ["node", "src/app.js"]
