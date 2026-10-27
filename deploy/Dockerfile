# syntax=docker/dockerfile:1.7
# MobSimLab application image: API + SPA + simulation worker, supervised by s6-overlay (ADR-0003).
# Build from the repository root:  docker build -f deploy/Dockerfile -t mobsimlab .

ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12
ARG RUST_VERSION=1.97
ARG S6_OVERLAY_VERSION=3.2.1.0

# ---- 1. Web SPA and API (Node) ------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS node-build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps apps
RUN pnpm -r build \
 && pnpm --filter @mobsimlab/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist /out/api/dist \
 && cp -r apps/web/dist /out/web

# ---- 2. Rust kernels as a Python wheel --------------------------------------
FROM rust:${RUST_VERSION}-slim-bookworm AS rust-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/maturin && /opt/maturin/bin/pip install --no-cache-dir "maturin>=1.9,<2"
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN /opt/maturin/bin/maturin build --release -m crates/mobsim-py/Cargo.toml -o /wheels

# ---- 3. Python worker virtualenv --------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS py-build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /src/worker
COPY worker/pyproject.toml worker/uv.lock ./
RUN uv venv /app/venv && VIRTUAL_ENV=/app/venv uv sync --active --frozen --no-dev --no-install-project --extra sim
COPY worker/src src
COPY --from=rust-build /wheels /wheels
RUN VIRTUAL_ENV=/app/venv uv pip install --no-deps . /wheels/*.whl

# ---- 4. Runtime ----------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ARG S6_OVERLAY_VERSION
ARG TARGETARCH
LABEL org.opencontainers.image.source="https://github.com/homlo-bike/MobSimLab" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.title="MobSimLab"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates xz-utils curl \
 && rm -rf /var/lib/apt/lists/*

# s6-overlay (ISC). Each archive is checked against the checksum published with the release.
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in amd64) a=x86_64 ;; arm64) a=aarch64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    cd /tmp; \
    for f in s6-overlay-noarch.tar.xz "s6-overlay-${a}.tar.xz"; do \
      curl -fsSLO "$base/$f"; curl -fsSLO "$base/$f.sha256"; sha256sum -c "$f.sha256"; \
      tar -C / -Jxpf "$f"; rm "$f" "$f.sha256"; \
    done; \
    apt-get purge -y curl xz-utils && apt-get autoremove -y

COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
COPY --from=node-build /out/api /app/api
COPY --from=node-build /out/web /app/web
COPY --from=py-build /app/venv /app/venv
COPY deploy/bin /app/bin
COPY deploy/s6/s6-rc.d /etc/s6-overlay/s6-rc.d
COPY LICENSE /app/LICENSE

RUN groupadd --system --gid 10001 mobsimlab \
 && useradd --system --uid 10001 --gid mobsimlab --home-dir /data --shell /usr/sbin/nologin mobsimlab \
 && mkdir -p /data && chown mobsimlab:mobsimlab /data

ENV PATH="/app/venv/bin:/command:${PATH}" \
    NODE_ENV=production \
    MOBSIMLAB_WEB_DIR=/app/web \
    MOBSIMLAB_PORT=8080 \
    S6_READ_ONLY_ROOT=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=120000

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["/app/bin/healthcheck"]
ENTRYPOINT ["/init"]
