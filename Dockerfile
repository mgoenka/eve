FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY agent.ts ./
COPY constants.ts ./
COPY types.ts ./
COPY tsconfig.json ./

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["npx", "tsx", "server.ts"]
