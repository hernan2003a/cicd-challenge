FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app

ARG APP_VERSION=unknown
ENV NODE_ENV=production \
		APP_ENV=production \
		APP_VERSION=${APP_VERSION}

COPY package*.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY src ./src
COPY server.js ./server.js

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O - "http://127.0.0.1:${PORT:-3001}/health" >/dev/null 2>&1 || exit 1

CMD ["npm", "start"]
