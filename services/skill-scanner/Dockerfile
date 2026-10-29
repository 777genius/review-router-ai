FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b AS build
WORKDIR /build
COPY build-requirements.lock requirements.lock ./
RUN python -m venv /venv \
    && /venv/bin/pip install --no-cache-dir --require-hashes -r build-requirements.lock \
    && /venv/bin/pip install --no-cache-dir --no-build-isolation --require-hashes -r requirements.lock
RUN TIKTOKEN_CACHE_DIR=/venv/share/tiktoken /venv/bin/python -c 'import tiktoken; tiktoken.get_encoding("cl100k_base"); tiktoken.get_encoding("o200k_base")'

FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b
COPY --from=build /venv /venv
WORKDIR /app
COPY server.py job.py child.py egress.py Dockerfile requirements.lock build-requirements.lock ./
ENV PATH="/venv/bin:/usr/bin:/bin" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/venv/bin/python", "-I", "/app/server.py"]
