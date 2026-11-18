#!/usr/bin/env bash
# Установка тестового стенда GunRaid на чистый сервер Ubuntu (под root).
#
#   curl -fsSL https://raw.githubusercontent.com/kaboomenko/gunraid/refs/heads/claude/new-session-kvf1bn/scripts/server-setup.sh | bash
#   С доменом (A-запись уже указывает на сервер) — HTTPS:
#   curl -fsSL .../server-setup.sh | DOMAIN=example.com bash
#   Доп. домены — постоянный редирект на основной (их A-записи тоже на сервер):
#   curl -fsSL .../server-setup.sh | DOMAIN=example.com EXTRA_DOMAINS="www.example.com example.net" bash
#   Пароль (basic auth): PROTECT=1 — на весь сайт, PROTECT=admin — только на админку
#   (/admin и /api/v1/admin), PROTECT=0 — выключен (по умолчанию); ROTATE_PASSWORD=1 — новый пароль.
#   Поисковики: по умолчанию сайт закрыт от индексации (заголовок X-Robots-Tag: noindex),
#   ALLOW_INDEXING=1 — открыть (для публичного запуска).
#   Домены и эти настройки запоминаются (.server-config): для обновления хватает команды без параметров.
#
# Что делает: ставит Docker, скачивает проект в /opt/gunraid, генерирует секреты в .env
# (только на сервере), собирает и запускает. Повторный запуск обновляет код и пересобирает,
# секреты и пароль сохраняются. Внимание: тестовый вход («Игрок», «Админ») включён — без
# PROTECT=1 зайти в админку может любой, кто откроет сайт.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kaboomenko/gunraid.git}"
BRANCH="${BRANCH:-claude/new-session-kvf1bn}"
DIR="${GUNRAID_DIR:-/opt/gunraid}"
SITE_USER="gunraid"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "запустите под root (или через sudo)"

if [ -z "${SKIP_DOCKER_INSTALL:-}" ]; then
  say "Пакеты и Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl openssl ca-certificates >/dev/null
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || fail "нет docker compose"

# Мало памяти — добавляем swap, чтобы сборка фронта не упала.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 6000 ] && ! swapon --show | grep -q . && [ ! -f /swapfile ]; then
  say "Swap 4 ГБ (памяти ${mem_mb} МБ)"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Код: $REPO_URL ($BRANCH) → $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
cd "$DIR"

# Домены запоминаем: повторный запуск без DOMAIN не должен вернуть сайт на IP.
CONF_FILE="$DIR/.server-config"
SAVED_DOMAIN=""
SAVED_EXTRA=""
SAVED_PROTECT=""
SAVED_INDEXING=""
if [ -f "$CONF_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONF_FILE"
  SAVED_DOMAIN="${SERVER_DOMAIN:-}"
  SAVED_EXTRA="${SERVER_EXTRA_DOMAINS:-}"
  SAVED_PROTECT="${SERVER_PROTECT:-}"
  SAVED_INDEXING="${SERVER_ALLOW_INDEXING:-}"
fi
if [ -z "$SAVED_DOMAIN" ] && [ -f .env ]; then
  # Установка первой версией скрипта (или прерванный запуск): домен записан только в .env.
  SAVED_DOMAIN="$(sed -n 's#^PUBLIC_URL=https://\([^/]*\).*#\1#p' .env | head -n 1)"
fi
# Флаги: 1/0, yes/no, true/false, on/off в любом регистре; опечатка — ошибка, а не молчаливый «0».
flag() {
  case "$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | yes | true | on) echo 1 ;;
    "" | 0 | no | false | off) echo 0 ;;
    *) fail "$1 должен быть 1 или 0, а сейчас «$2»" ;;
  esac
}
DOMAIN="${DOMAIN:-$SAVED_DOMAIN}"
EXTRA_DOMAINS="$(echo "${EXTRA_DOMAINS:-$SAVED_EXTRA}" | tr ',' ' ' | xargs)"
# Основной домен в списке редиректов дал бы два одинаковых сайта в Caddyfile — Caddy не стартует.
if [ -n "$DOMAIN" ] && [ -n "$EXTRA_DOMAINS" ]; then
  EXTRA_DOMAINS="$(echo "$EXTRA_DOMAINS" | tr ' ' '\n' | grep -vixF "$DOMAIN" | awk '!seen[tolower($0)]++' | xargs || true)"
fi
# Пароль: all — весь сайт, admin — только админка, off — нет (старые значения 1/0 = all/off).
protect_mode() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | yes | true | on | all) echo all ;;
    admin) echo admin ;;
    "" | 0 | no | false | off) echo off ;;
    *) fail "PROTECT должен быть 1, admin или 0, а сейчас «$1»" ;;
  esac
}
PROTECT="$(protect_mode "${PROTECT:-$SAVED_PROTECT}")"
ALLOW_INDEXING="$(flag ALLOW_INDEXING "${ALLOW_INDEXING:-$SAVED_INDEXING}")"
ROTATE_PASSWORD="$(flag ROTATE_PASSWORD "${ROTATE_PASSWORD:-}")"

# Адрес сайта
if [ -n "$DOMAIN" ]; then
  PUBLIC_URL="https://$DOMAIN"
  COOKIE_SECURE=true
  SITE_ADDR="$DOMAIN"
  GLOBAL_OPTS=""
else
  IP=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  PUBLIC_URL="http://$IP"
  COOKIE_SECURE=false
  SITE_ADDR=":80"
  GLOBAL_OPTS="auto_https off"
fi

say "Секреты (.env только на сервере)"
CRED_FILE="$DIR/.server-credentials"
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
# Создано scripts/server-setup.sh $(date -u +%Y-%m-%dT%H:%MZ). Не коммитить.
APP_ENV=staging
PUBLIC_URL=$PUBLIC_URL
COOKIE_SECURE=$COOKIE_SECURE
AUTH_DEV_LOGIN=true
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
FAIR_SEED_KEY=$(openssl rand -hex 32)
PAYMENT_MOCK_SECRET=$(openssl rand -hex 24)
EOF
else
  # Адрес мог смениться (добавили домен) — обновляем только его.
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$PUBLIC_URL#; s#^COOKIE_SECURE=.*#COOKIE_SECURE=$COOKIE_SECURE#" .env
fi
chmod 600 .env

AUTH_BLOCK=""
SITE_PASSWORD=""
if [ "$PROTECT" != off ]; then
  if [ ! -f "$CRED_FILE" ] || [ "$ROTATE_PASSWORD" = 1 ]; then
    umask 077
    echo "SITE_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)" > "$CRED_FILE"
  fi
  chmod 600 "$CRED_FILE"
  SITE_PASSWORD_HASH=""
  SITE_PASSWORD_HASH_OF=""
  # shellcheck disable=SC1090
  . "$CRED_FILE"
  # Хэш храним рядом с паролем: bcrypt с новой солью менял бы конфиг (и перезапускал Caddy)
  # на каждом запуске. Пересчитываем, только если сменился сам пароль (в том числе вручную).
  PW_FINGERPRINT="$(printf '%s' "$SITE_PASSWORD" | sha256sum | cut -d' ' -f1)"
  if [ -z "$SITE_PASSWORD_HASH" ] || [ "$SITE_PASSWORD_HASH_OF" != "$PW_FINGERPRINT" ]; then
    SITE_PASSWORD_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$SITE_PASSWORD" </dev/null)
    printf "SITE_PASSWORD=%q\nSITE_PASSWORD_HASH='%s'\nSITE_PASSWORD_HASH_OF=%s\n" \
      "$SITE_PASSWORD" "$SITE_PASSWORD_HASH" "$PW_FINGERPRINT" > "$CRED_FILE"
  fi
  HASH="$SITE_PASSWORD_HASH"
  if [ "$PROTECT" = admin ]; then
    AUTH_BLOCK="$(printf '\t@admin path /admin /admin/* /api/v1/admin/*\n\tbasic_auth @admin {\n\t\t%s %s\n\t}' "$SITE_USER" "$HASH")"
  else
    AUTH_BLOCK="$(printf '\tbasic_auth {\n\t\t%s %s\n\t}' "$SITE_USER" "$HASH")"
  fi
fi
ROBOTS_LINE=""
if [ "$ALLOW_INDEXING" != 1 ]; then
  ROBOTS_LINE="$(printf '\theader X-Robots-Tag "noindex, nofollow"')"
fi

CADDYFILE=infra/caddy/Caddyfile.server
CADDY_NEW="$(mktemp)"
case "$PROTECT" in all) PROTECT_TEXT="на весь сайт" ;; admin) PROTECT_TEXT="только на админку" ;; *) PROTECT_TEXT="выключен" ;; esac
say "Caddy: $SITE_ADDR; пароль: $PROTECT_TEXT; индексация: $([ "$ALLOW_INDEXING" = 1 ] && echo разрешена || echo запрещена)"
cat > "$CADDY_NEW" <<EOF
{
	admin off
	$GLOBAL_OPTS
}

$SITE_ADDR {
	encode zstd gzip
$ROBOTS_LINE
$AUTH_BLOCK

	@backend path /api/* /socket.io/*
	handle @backend {
		reverse_proxy api:4000
	}

	handle {
		reverse_proxy web:3000
	}
}
EOF
if [ -n "$DOMAIN" ] && [ -n "$EXTRA_DOMAINS" ]; then
  cat >> "$CADDY_NEW" <<EOF

$(echo "$EXTRA_DOMAINS" | sed 's/ /, /g') {
	redir https://$DOMAIN{uri} permanent
}
EOF
fi

# Проверяем конфиг до применения: с битым конфигом Caddy не стартует, и сайт ляжет.
if ! docker run --rm -v "$CADDY_NEW:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null >/dev/null 2>&1; then
  docker run --rm -v "$CADDY_NEW:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null || true
  rm -f "$CADDY_NEW"
  fail "сгенерированный конфиг Caddy не прошёл проверку (см. выше), сайт не тронут"
fi
# Перезапись на месте (тот же inode): файл смонтирован в контейнер.
cat "$CADDY_NEW" > "$CADDYFILE"
rm -f "$CADDY_NEW"

# Настройки запоминаем только после успешной проверки — ошибочный параметр не «застрянет».
umask 077
printf 'SERVER_DOMAIN="%s"\nSERVER_EXTRA_DOMAINS="%s"\nSERVER_PROTECT="%s"\nSERVER_ALLOW_INDEXING="%s"\n' \
  "$DOMAIN" "$EXTRA_DOMAINS" "$PROTECT" "$ALLOW_INDEXING" > "$CONF_FILE"
chmod 600 "$CONF_FILE"

# docker compose подхватывает override автоматически. Метка с хэшем конфига: Caddy читает конфиг
# только при старте, а изменение смонтированного файла compose сам не замечает. С меткой compose
# пересоздаёт Caddy ровно тогда, когда запущенный контейнер стартовал с другим конфигом — в том
# числе если прошлый запуск оборвался между записью конфига и перезапуском.
CADDY_SUM="$(sha256sum "$CADDYFILE" | cut -d' ' -f1)"
cat > docker-compose.override.yml <<EOF
# Создано scripts/server-setup.sh: Caddy на 80/443 со своим конфигом и сертификатами.
services:
  caddy:
    labels:
      gunraid.caddyfile-sha256: "$CADDY_SUM"
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./infra/caddy/Caddyfile.server:/etc/caddy/Caddyfile:ro
      - caddy_data:/data

volumes:
  caddy_data:
EOF

# Сначала — Caddy (пароль, домены): так настройка вступает в силу, даже если сборка сайта упадёт.
# compose пересоздаёт его только при смене конфига (метка выше).
say "Caddy: применение конфигурации"
docker compose up -d --no-deps caddy
for _ in $(seq 1 20); do
  curl -s -o /dev/null --max-time 2 http://127.0.0.1/ && break
  sleep 1
done
curl -s -o /dev/null --max-time 2 http://127.0.0.1/ ||
  fail "Caddy не отвечает — см. cd $DIR && docker compose logs caddy"

say "Сборка и запуск (первый раз 5–15 минут)"
if [ -n "${NO_BUILD:-}" ]; then docker compose up -d --wait; else docker compose up -d --build --wait; fi


say "Готово"
cat <<EOF

  Сайт:   $PUBLIC_URL${EXTRA_DOMAINS:+
  Редирект: $EXTRA_DOMAINS → $PUBLIC_URL}
EOF
if [ "$PROTECT" != off ]; then
  cat <<EOF
  Пароль $PROTECT_TEXT — логин: $SITE_USER, пароль: $SITE_PASSWORD   (хранится в $CRED_FILE)
EOF
fi
if [ "$PROTECT" = off ]; then
  cat <<EOF
  Пароля нет: тестовый вход, включая «Админ», доступен всем. В админке видны IP-адреса и
  устройства всех, кто заходил на сайт. Пароль только на админку: PROTECT=admin, на весь сайт: PROTECT=1.
EOF
fi
[ "$ALLOW_INDEXING" = 1 ] || echo "  Поисковики сайт не индексируют (noindex). Разрешить: ALLOW_INDEXING=1."
cat <<EOF

  Внутри сайта: «Войти» → «Тестовый вход» → «Игрок» или «Админ».
  Обновить до свежей версии — запустить команду установки ещё раз (параметры запоминаются).
  Логи: cd $DIR && docker compose logs -f api worker
EOF
