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
RUN /app/api/.venv/bin/python -c "import hashlib,json,pathlib,os,re; assert re.fullmatch(r'ghcr.io/vectorize-io/hindsight-api@sha256:[a-f0-9]{64}',os.environ['HINDSIGHT_BASE_IMAGE']), 'An immutable reviewed base is mandatory'; m=json.load(open('/app/hardening-manifest.json')); assert m['profile']=='approved-source-v1' and m['nativeRevision']=='a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5' and m['nativeLockSha256']=='bbd9c8232906ea947c8fdc4096f75d2e778b921af5bdeac09f553495f81f9666'; p=pathlib.Path('/app/api/hindsight_api'); assert all(hashlib.sha256((p/f['path']).read_bytes()).hexdigest()==f['beforeSha256'] for f in m['files'] if f['beforeSha256']), 'Native base source differs from reviewed release'"
COPY --chown=hindsight:hindsight hindsight_api/ /app/api/hindsight_api/
RUN /app/api/.venv/bin/python -c "import hashlib,json,pathlib,importlib.util; m=json.load(open('/app/hardening-manifest.json')); p=pathlib.Path('/app/api/hindsight_api'); assert all(hashlib.sha256((p/f['path']).read_bytes()).hexdigest()==f['afterSha256'] for f in m['files']), 'Final hardening bytes differ from manifest'; assert pathlib.Path(importlib.util.find_spec('hindsight_api').origin)==p/'__init__.py', 'The running package must use the reviewed patched files'"
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
    HINDSIGHT_API_OPERATION_RETENTION_DAYS=0 \
    HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS=0 \
    HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false
ENTRYPOINT []
CMD ["hindsight-api"]
