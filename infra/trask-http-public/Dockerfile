# syntax=docker/dockerfile:1.7
# Build context: packed monorepo root (see .github/workflows/trask-http-public.yml).

FROM node:24-bookworm AS base
WORKDIR /workspace
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.workspace.json ./
COPY packages ./packages
COPY apps/trask-http-server ./apps/trask-http-server
COPY apps/holocron-web ./apps/holocron-web
COPY infra/trask-indexer ./infra/trask-indexer
COPY scripts ./scripts
COPY vendor/llm_fallbacks ./vendor/llm_fallbacks
COPY data/ingest-worker ./data/ingest-worker
COPY data/trask ./data/trask
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkotor/retrieval build
RUN pnpm --filter @openkotor/trask build
RUN pnpm --filter @openkotor/trask-http-server build
RUN pnpm --filter @openkotor/holocron-web build
RUN bash scripts/bootstrap_trask_research.sh
RUN bash scripts/bootstrap_trask_indexer.sh
RUN node scripts/export_trask_allowlist_catalog.mjs
RUN TRASK_INDEX_SEED_REQUIRE_INDEXER=0 bash scripts/trask_index_seed_for_qa.sh
# Drop pytest baselines and caches from Python venvs — shrinks export layer on CI runners.
RUN find /workspace/.venv-trask-research /workspace/.venv-trask-indexer \
    -type d \( -name tests -o -name __pycache__ \) -prune -exec rm -rf {} + 2>/dev/null || true \
  && find /workspace/.venv-trask-research /workspace/.venv-trask-indexer -type f -name '*.pyc' -delete 2>/dev/null || true

FROM base AS runtime
WORKDIR /workspace
ARG PORT=7860
ENV PORT=${PORT}
ENV TRASK_HTTP_PORT=${PORT}
ENV TRASK_WEB_ALLOW_ANONYMOUS=1
ENV TRASK_WEB_DEFAULT_USER_ID=qa-webui
ENV TRASK_WEB_RESEARCH_PYTHON=/workspace/.venv-trask-research/bin/python
ENV TRASK_INDEXER_BASE_URL=http://127.0.0.1:8790
ENV TRASK_PUBLIC_WEB_ORIGIN=https://openkotor.github.io
ENV TRASK_RESEARCH_TIMEOUT_MS=900000
ENV TRASK_RESEARCHWIZARD_TIMEOUT_MS=900000
ENV INGEST_STATE_DIR=/workspace/data/ingest-worker
ENV TRASK_HTTP_DATA_DIR=/workspace/data/trask-http-server
COPY --from=deps /workspace /workspace
COPY infra/trask-http-public/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 7860
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
