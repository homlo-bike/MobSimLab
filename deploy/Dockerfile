# syntax=docker/dockerfile:1.7
# MobSimLab application image: API + SPA + simulation worker, supervised by s6-overlay (ADR-0003).
# Build from the repository root:  docker build -f deploy/Dockerfile -t mobsimlab .

ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12
ARG RUST_VERSION=1.97
ARG S6_OVERLAY_VERSION=3.2.1.0
# Base images are pinned by digest as well as tag (security review), so a re-pushed tag cannot change a release
# build. To update one, change the version above and its digest here together:
#   docker buildx imagetools inspect <image>:<tag>   (the first "Digest:" line, the multi-platform index)
ARG RUST_DIGEST=sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
ARG NODE_DIGEST=sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG PYTHON_DIGEST=sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

# ---- 0. Street routing, railway design and journey planner compiled to WebAssembly
FROM rust:${RUST_VERSION}-slim-bookworm@${RUST_DIGEST} AS wasm-build
ARG WASM_BINDGEN_VERSION=0.2.129
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown \
 && cargo install wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" --locked
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY tools/wasm tools/wasm
RUN tools/wasm/build-street-routing.sh && tools/wasm/build-rail-design.sh && tools/wasm/build-rail-sim.sh && tools/wasm/build-journey-planner.sh \
 && tools/wasm/build-mode-kits.sh \
 && tools/wasm/build-noise.sh \
 && tools/wasm/build-energy.sh \
 && tools/wasm/build-gtfs.sh \
 && tools/wasm/build-cargo-bike.sh \
 && tools/wasm/build-depot-layout.sh \
 && tools/wasm/build-api.sh

# ---- 1. Web SPA and API (Node) ------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim@${NODE_DIGEST} AS node-build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY --from=wasm-build /src/apps/web/src/wasm apps/web/src/wasm
COPY --from=wasm-build /src/apps/api/wasm apps/api/wasm
# The version and build the About dialog shows (the release workflow passes the tag and commit).
ARG MOBSIMLAB_VERSION=""
ARG MOBSIMLAB_BUILD="dev"
RUN MOBSIMLAB_VERSION="${MOBSIMLAB_VERSION}" MOBSIMLAB_BUILD="${MOBSIMLAB_BUILD}" pnpm -r build \
 && pnpm --filter @mobsimlab/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist /out/api/dist \
 && rm -rf /out/api/wasm && cp -r apps/api/wasm /out/api/wasm \
 && cp -r apps/web/dist /out/web

# ---- 2. Rust kernels as a Python wheel --------------------------------------
FROM rust:${RUST_VERSION}-slim-bookworm@${RUST_DIGEST} AS rust-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/maturin && /opt/maturin/bin/pip install --no-cache-dir "maturin>=1.9,<2"
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN /opt/maturin/bin/maturin build --release -m crates/mobsim-py/Cargo.toml -o /wheels

# ---- 3. Python worker virtualenv --------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm@${PYTHON_DIGEST} AS py-build
COPY --from=ghcr.io/astral-sh/uv:0.11@sha256:77280f2f771df71f90786c314fe1bbc1e023feac652969bbf139c280babf2eb7 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /src/worker
COPY worker/pyproject.toml worker/uv.lock ./
RUN uv venv /app/venv && VIRTUAL_ENV=/app/venv uv sync --active --frozen --no-dev --no-install-project --extra sim --extra demand
COPY worker/src src
COPY --from=rust-build /wheels /wheels
RUN VIRTUAL_ENV=/app/venv uv pip install --no-deps . /wheels/*.whl

# ---- 4. Runtime ----------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm@${PYTHON_DIGEST} AS runtime
ARG S6_OVERLAY_VERSION
ARG TARGETARCH
LABEL org.opencontainers.image.source="https://github.com/homlo-bike/MobSimLab" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.title="MobSimLab"

# osmium-tool (GPL-3.0) and osm2pgsql (GPL-2.0) import a project's OpenStreetMap data (ADR-0046); they run as
# separate programs, never linked into MobSimLab. libatomic1: the eclipse-sumo wheel's netconvert and sumo link
# against libatomic.so.1, which the slim image lacks (road runs failed with "libatomic.so.1: cannot open shared
# object file"). The sumo program is built with its GUI libraries, so it also needs the system's X11 and OpenGL
# client libraries (libX11, libXext, libXrender, libGL) and libexpat, which the wheel does not bundle; nothing
# draws on a screen, they only have to load.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates xz-utils curl osmium-tool osm2pgsql \
      libatomic1 libx11-6 libxext6 libxrender1 libgl1 libexpat1 \
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
# Fail the build, not a planner's road run, when a SUMO program cannot start (a shared library missing).
RUN /app/venv/bin/python -c "import os, subprocess, sumo; b = os.path.join(os.path.dirname(sumo.__file__), 'bin'); \
    [subprocess.run([os.path.join(b, x), '--version'], check=True, stdout=subprocess.DEVNULL) for x in ('netconvert', 'sumo')]"
COPY db/migrations /app/db/migrations
COPY tools/osm/mobsimlab-flex.lua tools/osm/tag_mapping.lua /app/osm/
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
    MOBSIMLAB_OSM_STYLE_DIR=/app/osm \
    MOBSIMLAB_LOG_DIR=/data/logs \
    S6_READ_ONLY_ROOT=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=120000

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["/app/bin/healthcheck"]
ENTRYPOINT ["/init"]
