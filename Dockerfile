FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src/ ./src/
COPY tsconfig.json ./
RUN pnpm build

FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/dist/ ./dist/
EXPOSE 3000
ENV SLACK_SOCKET_MODE=false
CMD ["node", "dist/app.js"]
