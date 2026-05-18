# syntax=docker/dockerfile:1.7
# Build context: packed monorepo root (see .github/workflows/trask-http-public.yml).

FROM node:24-bookworm AS base
WORKDIR /workspace
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.workspace.json ./
COPY packages ./packages
COPY apps/trask-http-server ./apps/trask-http-server
COPY vendor/ai-researchwizard ./vendor/ai-researchwizard
COPY vendor/llm_fallbacks ./vendor/llm_fallbacks
COPY scripts/bootstrap_trask_gpt_researcher.sh ./scripts/bootstrap_trask_gpt_researcher.sh
COPY data/ingest-worker ./data/ingest-worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkotor/trask-http-server build
RUN bash scripts/bootstrap_trask_gpt_researcher.sh

FROM base AS runtime
WORKDIR /workspace
ARG PORT=7860
ENV PORT=${PORT}
ENV TRASK_HTTP_PORT=${PORT}
ENV TRASK_WEB_ALLOW_ANONYMOUS=1
ENV TRASK_WEB_DEFAULT_USER_ID=qa-webui
ENV TRASK_GPT_RESEARCHER_PYTHON=/workspace/.venv-trask-gptr/bin/python
ENV TRASK_PUBLIC_WEB_ORIGIN=https://openkotor.github.io
ENV TRASK_RESEARCHWIZARD_TIMEOUT_MS=900000
ENV INGEST_STATE_DIR=/workspace/data/ingest-worker
ENV TRASK_HTTP_DATA_DIR=/workspace/data/trask-http-server
COPY --from=deps /workspace /workspace
EXPOSE 7860
CMD ["node", "apps/trask-http-server/dist/main.js"]
