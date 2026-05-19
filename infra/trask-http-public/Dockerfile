# syntax=docker/dockerfile:1.7
# Build context: packed monorepo root (see .github/workflows/trask-http-public.yml).

FROM node:24-bookworm AS base
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.workspace.json ./
COPY packages ./packages
COPY apps/trask-http-server ./apps/trask-http-server
COPY data/ingest-worker ./data/ingest-worker
COPY scripts/trask_web_research.py scripts/trask_web_research.py
COPY requirements-trask-research.txt requirements-trask-research.txt
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openkotor/trask-http-server build

FROM base AS python-research
WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libxml2-dev libxslt1-dev gcc \
  && rm -rf /var/lib/apt/lists/*
COPY requirements-trask-research.txt /workspace/requirements-trask-research.txt
COPY scripts/trask_web_research.py /workspace/scripts/trask_web_research.py
RUN python3 -m venv /workspace/.venv-trask-research \
  && /workspace/.venv-trask-research/bin/pip install --upgrade pip \
  && /workspace/.venv-trask-research/bin/pip install -r /workspace/requirements-trask-research.txt \
  && (/workspace/.venv-trask-research/bin/python -m crawl4ai install || true)

FROM base AS runtime
WORKDIR /workspace
ARG PORT=7860
ENV PORT=${PORT}
ENV TRASK_HTTP_PORT=${PORT}
ENV TRASK_WEB_ALLOW_ANONYMOUS=1
ENV TRASK_WEB_DEFAULT_USER_ID=qa-webui
ENV TRASK_PUBLIC_WEB_ORIGIN=https://openkotor.github.io
ENV TRASK_RESEARCHWIZARD_TIMEOUT_MS=900000
ENV TRASK_WEB_RESEARCH_PYTHON=/workspace/.venv-trask-research/bin/python
ENV INGEST_STATE_DIR=/workspace/data/ingest-worker
ENV TRASK_HTTP_DATA_DIR=/workspace/data/trask-http-server
COPY --from=deps /workspace /workspace
COPY --from=python-research /workspace/.venv-trask-research /workspace/.venv-trask-research
COPY --from=python-research /workspace/scripts/trask_web_research.py /workspace/scripts/trask_web_research.py
EXPOSE 7860
CMD ["node", "apps/trask-http-server/dist/main.js"]
