FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy bot source
COPY src/ ./src/

# Persistent data directory for JSON store
RUN mkdir -p bot-data

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "./src/index.mjs"]
