# ---- build: install everything, bundle the client into dist/ ----
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: production deps only + the server sources ----
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY server.ts agent.ts constants.ts types.ts tsconfig.json ./
COPY lib ./lib
COPY server ./server
COPY data ./data
EXPOSE 8080
USER node
# node + the tsx loader directly (no npx/npm wrapper process: faster start, less memory).
CMD ["node", "--import", "tsx", "server.ts"]
