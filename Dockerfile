# ---- build: install everything, bundle the client into dist/ ----
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: production deps only + the compiled server ----
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# The server is precompiled to one plain-JS file (scripts/build-server.mjs), so the
# runtime needs no TypeScript sources and no tsx loader.
COPY --from=builder /app/dist-server ./dist-server
EXPOSE 8080
USER node
# Plain node on the precompiled bundle (no npx/npm wrapper, no runtime transpile).
CMD ["node", "dist-server/server.mjs"]
