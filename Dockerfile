# syntax=docker/dockerfile:1
#
# Production image for InfiniaWebService — the unified web service of the Infinia
# Store Platform (REST API + OAuth authorization server + embedded Store Web SPA
# + embedded official website on one origin, port 8080).
#
#   docker build -t infinia-webservice .
#   docker run -d --name webservice -p 8080:8080 \
#     -e STORE_BASE_URL=https://store.example.com \
#     -e STORE_TICKET_SECRET=... -e STORE_ROLLOUT_SECRET=... \
#     -e STORE_CLI_CLIENT_SECRET=... \
#     [-e STORE_STORAGE_TYPE=s3 -e STORE_STORAGE_S3_ENDPOINT=... \
#      -e STORE_STORAGE_S3_BUCKET=... -e STORE_STORAGE_S3_ACCESS_KEY=... \
#      -e STORE_STORAGE_S3_SECRET_KEY=...] \
#     -v store-data:/var/lib/infinia-store infinia-webservice
#
# `docker compose --profile app up` wires this against the stack's PostgreSQL
# and MinIO (bucket store-blobs); the three STORE_*_SECRET variables come from
# .env (see .env.example). Redis ships with the stack per the platform design
# but is not yet wired into the application.

# ---- Stage 1: unified frontend (store + introduction) ------------------
FROM node:22-alpine AS web
WORKDIR /workspace
RUN corepack enable
# Workspace manifests first so dependency resolution caches on its own layer.
COPY package.json yarn.lock .yarnrc.yml ./
COPY store-web/package.json store-web/package.json
COPY monitor-web/package.json monitor-web/package.json
RUN yarn install --immutable
COPY store-web/ store-web/
# Absolute asset origin (Cloudflare Pages) — changes the bundle bytes/hashes, so
# it must equal the ASSETS_BASE_URL the CI asset publish builds with. Empty
# keeps assets same-origin and existing deployments unchanged.
ARG ASSETS_BASE_URL=""
RUN ASSETS_BASE_URL="$ASSETS_BASE_URL" yarn workspace @infinia/store-web build \
 && test -f store-web/dist/index.html

# ---- Stage 2: executable Boot jar -------------------------------------------
# Tests run in CI (`./mvnw verify`); the image build stays fast and reproducible.
FROM maven:3.9-eclipse-temurin-21 AS jar
WORKDIR /build
# Optional Maven mirror for slow links to Maven Central (docker-compose passes
# MAVEN_MIRROR from .env, e.g. https://maven.aliyun.com/repository/public);
# empty keeps the default Maven Central — overseas deployments change nothing.
ARG MAVEN_MIRROR=""
COPY docker/maven-settings.xml /tmp/maven-settings.xml
RUN if [ -n "$MAVEN_MIRROR" ]; then mkdir -p /root/.m2 \
 && sed "s|__MAVEN_MIRROR__|$MAVEN_MIRROR|g" /tmp/maven-settings.xml > /root/.m2/settings.xml; fi
COPY mvnw pom.xml ./
COPY .mvn .mvn
COPY store-contract/pom.xml store-contract/pom.xml
COPY store-domain/pom.xml store-domain/pom.xml
COPY store-infrastructure/pom.xml store-infrastructure/pom.xml
COPY store-scanner/pom.xml store-scanner/pom.xml
COPY store-application/pom.xml store-application/pom.xml
COPY store-monitor/pom.xml store-monitor/pom.xml
# Warm the dependency layer; a miss only costs time on the next COPY layer.
RUN ./mvnw -B -q -pl store-application -am dependency:go-offline -DskipTests || true
COPY store-contract store-contract
COPY store-domain store-domain
COPY store-infrastructure store-infrastructure
COPY store-scanner store-scanner
COPY store-application store-application
COPY store-monitor store-monitor
# One frontend output contains both the store and introduction routes.
COPY --from=web /workspace/store-web/dist store-web/dist
RUN ./mvnw -B -pl store-application -am package -DskipTests \
 && JAR=$(ls store-application/target/InfiniaWebService-*.jar | grep -v '\.original$' | head -1) \
 && test -n "$JAR" \
 && jar tf "$JAR" | grep -q 'BOOT-INF/classes/static/index.html' \
 && cp "$JAR" /InfiniaWebService.jar

# ---- Stage 3: runtime -------------------------------------------------------
FROM eclipse-temurin:21-jre-noble AS runtime
# OCI labels belong to a build stage — a LABEL before the first FROM is invalid.
LABEL org.opencontainers.image.title="InfiniaWebService"
LABEL org.opencontainers.image.description="The unified web service of the Infinia / FengYu ecosystem: official website, store catalog, publishing pipeline, review workflow, signed delivery and accounts on one origin."
LABEL org.opencontainers.image.source="https://github.com/MuskStark/FengYu-WebSite"
LABEL org.opencontainers.image.licenses="GPL-3.0-only"
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system infinia \
 && useradd --system --gid infinia --home-dir /var/lib/infinia-store --shell /usr/sbin/nologin infinia \
 && mkdir -p /var/lib/infinia-store \
 && chown -R infinia:infinia /var/lib/infinia-store
ENV TZ=UTC \
    JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -Djava.security.egd=file:/dev/./urandom" \
    # Local blob/key storage anchors to the persistent volume; S3 deployments
    # override with STORE_STORAGE_TYPE=s3 + STORE_STORAGE_S3_* and ignore it.
    STORE_BLOB_DIR=/var/lib/infinia-store/blobs \
    STORE_KEY_DIR=/var/lib/infinia-store/keys
WORKDIR /app
COPY --from=jar --chown=infinia:infinia /InfiniaWebService.jar InfiniaWebService.jar
USER infinia
EXPOSE 8080
VOLUME /var/lib/infinia-store
# start-period covers the boot-time catalog sync on cold catalogs; retries
# lowered to fail fast once the period is over.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5m --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/actuator/health | grep -qs UP || exit 1
ENTRYPOINT ["/bin/sh", "-c", "exec java $JAVA_OPTS -jar /app/InfiniaWebService.jar"]
