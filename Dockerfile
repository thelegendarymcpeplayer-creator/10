FROM node:20-alpine
WORKDIR /app

# Install only discord.js (everything else is pre-bundled)
COPY package.json ./
RUN npm install --omit=dev

# Copy pre-built bundle
COPY dist/ ./dist/

# Persistent data directory for bot store
RUN mkdir -p bot-data

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
