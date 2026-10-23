# Build context is produced by scripts/hindsight-e2e/prepare-hardening.ts.
# The caller must resolve the reviewed release to an immutable manifest digest.
ARG HINDSIGHT_BASE_IMAGE
FROM ${HINDSIGHT_BASE_IMAGE}
ARG HINDSIGHT_BASE_IMAGE
LABEL org.opencontainers.image.title="ReviewRouter Hindsight privacy profile" \
      org.opencontainers.image.base.name="${HINDSIGHT_BASE_IMAGE}" \
      io.reviewrouter.hindsight.source-revision="a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5" \
      io.reviewrouter.hindsight.profile="approved-source-v1"
COPY --chown=hindsight:hindsight hardening-manifest.json /app/hardening-manifest.json
RUN /app/api/.venv/bin/python -c "import hashlib,json,pathlib; m=json.load(open('/app/hardening-manifest.json')); p=pathlib.Path('/app/api/hindsight_api'); assert all(hashlib.sha256((p/f['path']).read_bytes()).hexdigest()==f['beforeSha256'] for f in m['files'] if f['beforeSha256']), 'Native base source differs from reviewed release'"
COPY --chown=hindsight:hindsight hindsight_api/ /app/api/hindsight_api/
RUN /app/api/.venv/bin/python -m compileall -q /app/api/hindsight_api
ENV HINDSIGHT_API_LLM_TRACE_ENABLED=false \
    HINDSIGHT_API_OTEL_TRACES_ENABLED=false \
    HINDSIGHT_API_AUDIT_LOG_ENABLED=false \
    HINDSIGHT_API_LLM_DEBUG_DUMP_4XX=false \
    HINDSIGHT_API_XAI_OAUTH_DEBUG_HEADERS=false \
    HINDSIGHT_API_MCP_ENABLED=false \
    HINDSIGHT_API_ENABLE_FILE_UPLOAD_API=false \
    HINDSIGHT_API_ACCESS_LOG=false \
    HINDSIGHT_API_FAIL_ON_EXTRACTION_ERRORS=true \
    HINDSIGHT_API_WORKER_ENABLED=false \
    HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false
ENTRYPOINT []
CMD ["hindsight-api"]
