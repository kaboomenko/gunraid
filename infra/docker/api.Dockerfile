# syntax=docker/dockerfile:1.7
# Образ API: используется сервисами api, worker и migrate.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Необязательный секрет extra_ca — корневой сертификат для сборки за корпоративным TLS-прокси:
#   docker build --secret id=extra_ca,src=/path/ca.crt ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@gunraid/api..."
RUN pnpm --filter "@gunraid/api..." run build
# Оставляем только production-зависимости.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --prod --filter "@gunraid/api..."

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
