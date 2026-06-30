===
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build 2>/dev/null || true

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["node", "dist/server.js"]