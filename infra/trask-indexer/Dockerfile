FROM python:3.12-slim-bookworm

WORKDIR /app
COPY pyproject.toml README.md ./
COPY trask_indexer ./trask_indexer

RUN pip install --no-cache-dir -e .

ENV TRASK_INDEXER_DATA_DIR=/data/trask-indexer
EXPOSE 8790

CMD ["uvicorn", "trask_indexer.retrieve_api:app", "--host", "0.0.0.0", "--port", "8790"]
