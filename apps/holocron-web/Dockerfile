# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.workspace.json ./
COPY packages ./packages
COPY apps/holocron-web ./apps/holocron-web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkotor/platform build \
  && pnpm --filter @openkotor/trask build \
  && pnpm --filter @openkotor/holocron-web build

FROM base AS runtime
WORKDIR /workspace
ARG PORT=5174
ENV PORT=${PORT}
COPY --from=deps /workspace/package.json ./package.json
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --from=deps /workspace/tsconfig.workspace.json ./tsconfig.workspace.json
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/packages ./packages
COPY --from=deps /workspace/apps/holocron-web ./apps/holocron-web

EXPOSE 5174
CMD ["sh", "-lc", "pnpm --filter @openkotor/holocron-web preview --host 0.0.0.0 --port \"${PORT:-5174}\" --strictPort"]
