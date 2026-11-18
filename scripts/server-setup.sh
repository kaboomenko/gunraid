#!/usr/bin/env bash
# Установка тестового стенда GunRaid на чистый сервер Ubuntu (под root).
#
#   curl -fsSL https://raw.githubusercontent.com/kaboomenko/gunraid/refs/heads/claude/new-session-kvf1bn/scripts/server-setup.sh | bash
#   С доменом (A-запись уже указывает на сервер) — HTTPS:
#   curl -fsSL .../server-setup.sh | DOMAIN=test.example.com bash
#
# Что делает: ставит Docker, скачивает проект в /opt/gunraid, генерирует секреты в .env
# (только на сервере), закрывает весь сайт паролем (тестовый вход открыт — без пароля любой
# зашёл бы в админку), собирает и запускает. Повторный запуск обновляет код и пересобирает,
# секреты и пароль сохраняются.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kaboomenko/gunraid.git}"
BRANCH="${BRANCH:-claude/new-session-kvf1bn}"
DIR="${GUNRAID_DIR:-/opt/gunraid}"
DOMAIN="${DOMAIN:-}"
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

if [ ! -f "$CRED_FILE" ]; then
  umask 077
  echo "SITE_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)" > "$CRED_FILE"
fi
# shellcheck disable=SC1090
. "$CRED_FILE"
HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$SITE_PASSWORD")

say "Caddy: $SITE_ADDR, пароль на весь сайт"
cat > infra/caddy/Caddyfile.server <<EOF
{
	admin off
	$GLOBAL_OPTS
}

$SITE_ADDR {
	encode zstd gzip
	basic_auth {
		$SITE_USER $HASH
	}

	@backend path /api/* /socket.io/*
	handle @backend {
		reverse_proxy api:4000
	}

	handle {
		reverse_proxy web:3000
	}
}
EOF

# docker compose подхватывает override автоматически.
cat > docker-compose.override.yml <<'EOF'
# Создано scripts/server-setup.sh: Caddy на 80/443 с паролем и сертификатами.
services:
  caddy:
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./infra/caddy/Caddyfile.server:/etc/caddy/Caddyfile:ro
      - caddy_data:/data

volumes:
  caddy_data:
EOF

say "Сборка и запуск (первый раз 5–15 минут)"
if [ -n "${NO_BUILD:-}" ]; then docker compose up -d --wait; else docker compose up -d --build --wait; fi

say "Готово"
cat <<EOF

  Сайт:   $PUBLIC_URL
  Логин:  $SITE_USER
  Пароль: $SITE_PASSWORD

  Внутри сайта: «Войти» → «Тестовый вход» → «Игрок» или «Админ».
  Обновить до свежей версии — запустить эту же команду ещё раз.
  Логи: cd $DIR && docker compose logs -f api worker
  Пароль хранится в $CRED_FILE.
EOF
