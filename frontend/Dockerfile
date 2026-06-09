FROM node:24-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
