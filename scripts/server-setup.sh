#!/usr/bin/env bash
# Установка и обновление тестового стенда GunRaid на сервере Ubuntu (под root).
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
#   Автовыкладка: AUTO_UPDATE=1 (по умолчанию) — сервер раз в минуту проверяет ветку BRANCH и
#   выкладывает новые коммиты сам; AUTO_UPDATE=0 — выключить. Статус: <сайт>/deploy-status.txt,
#   версия: <сайт>/api/v1/health.
#   Все параметры запоминаются (.server-config): для обновления хватает команды без параметров.
#
# Что делает: ставит Docker, скачивает проект в /opt/gunraid, генерирует секреты в .env
# (только на сервере), собирает и запускает. Повторный запуск обновляет код и пересобирает,
# секреты и пароль сохраняются. Внимание: тестовый вход («Игрок», «Админ») включён — без
# пароля зайти в админку может любой, кто откроет сайт.
set -euo pipefail

DEFAULT_BRANCH="claude/new-session-kvf1bn"
REPO_URL="${REPO_URL:-https://github.com/kaboomenko/gunraid.git}"
DIR="${GUNRAID_DIR:-/opt/gunraid}"
UPDATER="${UPDATER_PATH:-/usr/local/bin/gunraid-update}"
LOCK_FILE="${GUNRAID_LOCK_FILE:-/run/gunraid-deploy.lock}"
DEPLOY_DIR="$DIR/.deploy"
SITE_USER="gunraid"
# Запуск из автовыкладки (gunraid-update): блокировку держит она, статус пишет она.
MANAGED="${GUNRAID_LOCKED:-}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "запустите под root (или через sudo)"

# Статус выкладки — публичный текстовый файл <сайт>/deploy-status.txt (без секретов).
# Эта же функция попадает в gunraid-update (см. ниже), поэтому описана строкой.
STATUS_FN='
write_status() {
  local dir="$DEPLOY_DIR/public" tmp
  mkdir -p "$dir"
  tmp="$dir/.deploy-status.tmp"
  {
    printf "state:    %s\n" "$1"
    printf "message:  %s\n" "$2"
    printf "running:  %s\n" "$(cat "$DEPLOY_DIR/deployed-commit" 2>/dev/null || echo none)"
    printf "branch:   %s\n" "$BRANCH"
    printf "updated:  %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [ -n "${3:-}" ] && [ -f "$3" ]; then
      printf "\n--- последние строки журнала ---\n"
      tail -n 80 "$3" | sed "s/\x1b\[[0-9;]*m//g" | grep -viE "парол|password|secret|token|SITE_" || true
    fi
  } > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$dir/deploy-status.txt"
}'
eval "$STATUS_FN"

# Одна выкладка за раз: ручной запуск ждёт, пока закончит автовыкладка.
if [ -z "$MANAGED" ]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    say "Сейчас идёт автовыкладка — жду, пока она закончится"
    flock 9
  fi
fi

if [ -z "${SKIP_DOCKER_INSTALL:-}" ]; then
  say "Пакеты и Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl openssl ca-certificates util-linux >/dev/null
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

# Сохранённые параметры (домены, пароль, ветка…): повторный запуск без параметров их не теряет.
CONF_FILE="$DIR/.server-config"
SAVED_DOMAIN=""
SAVED_EXTRA=""
SAVED_PROTECT=""
SAVED_INDEXING=""
SAVED_BRANCH=""
SAVED_AUTO=""
if [ -f "$CONF_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONF_FILE"
  SAVED_DOMAIN="${SERVER_DOMAIN:-}"
  SAVED_EXTRA="${SERVER_EXTRA_DOMAINS:-}"
  SAVED_PROTECT="${SERVER_PROTECT:-}"
  SAVED_INDEXING="${SERVER_ALLOW_INDEXING:-}"
  SAVED_BRANCH="${SERVER_BRANCH:-}"
  SAVED_AUTO="${SERVER_AUTO_UPDATE:-}"
fi
BRANCH="${BRANCH:-${SAVED_BRANCH:-$DEFAULT_BRANCH}}"

if [ -z "$MANAGED" ]; then
  # Ручной запуск оборвался — так и пишем в статусе (у автовыкладки статус пишет она сама).
  # До клонирования папки проекта ещё может не быть — тогда писать некуда.
  trap 'rc=$?; [ "$rc" -eq 0 ] || [ ! -d "$DIR/.git" ] || write_status failed "ручной запуск завершился с ошибкой (код $rc)"' EXIT
fi

say "Код: $REPO_URL ($BRANCH${PIN_COMMIT:+ @ ${PIN_COMMIT:0:12}}) → $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "${PIN_COMMIT:-origin/$BRANCH}"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
  if [ -n "${PIN_COMMIT:-}" ]; then git -C "$DIR" reset -q --hard "$PIN_COMMIT"; fi
fi
cd "$DIR"
mkdir -p "$DEPLOY_DIR/public"
COMMIT="$(git rev-parse HEAD)"
[ -n "$MANAGED" ] || write_status building "ручной запуск: версия ${COMMIT:0:12}"

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
AUTO_UPDATE="$(flag AUTO_UPDATE "${AUTO_UPDATE:-${SAVED_AUTO:-1}}")"

# Адрес сайта
if [ -n "$DOMAIN" ]; then
  PUBLIC_URL="https://$DOMAIN"
  COOKIE_SECURE=true
  SITE_ADDR="$DOMAIN"
  GLOBAL_OPTS=""
else
  # Внешний сервис только подсказывает IP: ответ проверяем по формату (дальше он идёт в sed и .env).
  IPV4_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
  IP="$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [[ "$IP" =~ $IPV4_RE ]] || IP="$(hostname -I | awk '{print $1}')"
  [[ "$IP" =~ $IPV4_RE ]] || fail "не удалось определить IP сервера — укажите домен: DOMAIN=example.com"
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
# Версия (коммит) — видна в /api/v1/health: так снаружи понятно, что выложено.
if grep -q '^APP_VERSION=' .env; then
  sed -i "s#^APP_VERSION=.*#APP_VERSION=${COMMIT:0:12}#" .env
else
  echo "APP_VERSION=${COMMIT:0:12}" >> .env
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

	handle /deploy-status.txt {
		root * /srv/deploy
		header Cache-Control "no-store"
		file_server
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
printf 'SERVER_DOMAIN="%s"\nSERVER_EXTRA_DOMAINS="%s"\nSERVER_PROTECT="%s"\nSERVER_ALLOW_INDEXING="%s"\nSERVER_BRANCH="%s"\nSERVER_AUTO_UPDATE="%s"\n' \
  "$DOMAIN" "$EXTRA_DOMAINS" "$PROTECT" "$ALLOW_INDEXING" "$BRANCH" "$AUTO_UPDATE" > "$CONF_FILE"
chmod 600 "$CONF_FILE"
umask 022

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
      - ./.deploy/public:/srv/deploy:ro
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

say "Сборка и запуск версии ${COMMIT:0:12} (первый раз 5–15 минут)"
# --wait-timeout: если сервис крутится в перезапусках, compose не ждёт вечно, а возвращает ошибку.
# --remove-orphans: сервисы, которых нет в этой версии (например, после отката), не остаются работать.
WAIT_TIMEOUT="${WAIT_TIMEOUT:-600}"
if [ -n "${NO_BUILD:-}" ]; then
  docker compose up -d --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"
else
  docker compose up -d --build --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"
fi

# compose может вернуть успех и по истечении --wait-timeout, поэтому проверяем сами: api и web
# запущены и прошли healthcheck, а api отвечает версией именно этого коммита.
verify_running() {
  local svc id
  for svc in api web; do
    id="$(docker compose ps -q "$svc" 2>/dev/null || true)"
    [ -n "$id" ] || return 1
    [ "$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")" = "running healthy" ] || return 1
  done
  docker compose exec -T api node -e \
    "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>r.json()).then(j=>process.exit(j.version===process.argv[1]?0:1)).catch(()=>process.exit(1))" \
    "${COMMIT:0:12}" </dev/null >/dev/null 2>&1
}
for _ in $(seq 1 30); do
  verify_running && break
  sleep 2
done
verify_running || fail "версия ${COMMIT:0:12} не поднялась: api/web не прошли проверку (см. docker compose ps и logs)"

# Выложено: запоминаем рабочую версию (к ней откатывается автовыкладка), чистим старые образы.
echo "$COMMIT" > "$DEPLOY_DIR/deployed-commit"
# Эта версия выложена — пометка о её неудачных попытках больше не нужна.
if [ -f "$DEPLOY_DIR/failed" ] && [ "$(cut -d' ' -f1 "$DEPLOY_DIR/failed")" = "$COMMIT" ]; then
  rm -f "$DEPLOY_DIR/failed"
fi
write_status ok "работает версия ${COMMIT:0:12}"
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

# ---------- Автовыкладка: gunraid-update + таймер systemd ----------
# Скрипт пишется во временный файл и подменяется через mv: работающая копия (если выкладку
# запустила она сама) дочитывает старый файл, а не изменённый на лету.
UPDATER_TMP="$(mktemp)"
cat > "$UPDATER_TMP" <<'UPD'
#!/usr/bin/env bash
# Создано scripts/server-setup.sh — автовыкладка GunRaid (таймер systemd gunraid-update.timer).
# Раз в минуту: в ветке новый коммит → выкладка. Не собралось — работает прежняя версия;
# собралось, но сайт не поднялся — откат на последнюю рабочую версию. Неудачный коммит
# повторяется не чаще раза в 15 минут и не больше 3 раз. FORCE=1 — повторить сразу.
set -euo pipefail
DIR='@DIR@'
LOCK_FILE='@LOCK@'
DEPLOY_DIR="$DIR/.deploy"
cd "$DIR"
SERVER_BRANCH=""
SERVER_AUTO_UPDATE=""
# shellcheck disable=SC1091
[ -f .server-config ] && . ./.server-config
BRANCH="${SERVER_BRANCH:-@BRANCH@}"
[ "${SERVER_AUTO_UPDATE:-1}" = 1 ] || exit 0
UPD
sed -i "s#@DIR@#$DIR#; s#@LOCK@#$LOCK_FILE#; s#@BRANCH@#$BRANCH#" "$UPDATER_TMP"
printf '%s\n' "$STATUS_FN" >> "$UPDATER_TMP"
cat >> "$UPDATER_TMP" <<'UPD'

# Сервис запущен (не в перезапусках) и прошёл healthcheck.
svc_ok() {
  local id
  id="$(docker compose ps -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" = "running healthy" ]
}
# Без healthcheck (worker, caddy): запущен и не в цикле перезапусков.
svc_running() {
  local id
  id="$(docker compose ps -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null)" = running ]
}
# Сайт здоров: api и web прошли healthcheck, worker и caddy запущены, Caddy отвечает на 80-м порту.
site_healthy() {
  svc_ok api && svc_ok web && svc_running worker && svc_running caddy &&
    curl -s -o /dev/null --max-time 3 http://127.0.0.1/
}

# Выкладка коммита $1 его же скриптом установки; журнал — в $2 (только для root).
# Успех — только если скрипт отработал, версия записана как выложенная и сайт здоров.
run_setup() {
  local script rc=0
  (umask 077 && : > "$2")
  script="$(mktemp)"
  if ! git show "$1:scripts/server-setup.sh" > "$script" 2>> "$2" || [ ! -s "$script" ]; then
    echo "в коммите ${1:0:12} нет scripts/server-setup.sh" >> "$2"
    rm -f "$script"
    return 1
  fi
  if ! grep -q 'PIN_COMMIT' "$script"; then
    echo "скрипт установки в коммите ${1:0:12} не поддерживает автовыкладку" >> "$2"
    rm -f "$script"
    return 1
  fi
  GUNRAID_LOCKED=1 SKIP_DOCKER_INSTALL=1 PIN_COMMIT="$1" \
    timeout --kill-after=60 "${DEPLOY_TIMEOUT:-25m}" bash "$script" >> "$2" 2>&1 < /dev/null || rc=$?
  rm -f "$script"
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -ne 124 ] || echo "превышено время выкладки (${DEPLOY_TIMEOUT:-25m})" >> "$2"
    return 1
  fi
  if [ "$(cat "$DEPLOY_DIR/deployed-commit" 2>/dev/null)" != "$1" ]; then
    echo "скрипт завершился, но версия ${1:0:12} не отмечена как выложенная" >> "$2"
    return 1
  fi
  # Сервис, который падает при старте, успевает «пройти» ожидание compose — проверяем ещё раз позже.
  sleep "${SETTLE_SECONDS:-20}"
  if ! site_healthy; then
    echo "после выкладки сайт нездоров (api/web не прошли проверку)" >> "$2"
    return 1
  fi
}

# Ограничение повторов: файл «sha время попыток»; не больше 3 попыток, не чаще раза в 15 минут.
may_try() { # file sha → 0 если можно пробовать; печатает номер попытки
  local f_sha="" f_time=0 f_count=0
  [ ! -f "$1" ] || read -r f_sha f_time f_count < "$1" || true
  if [ "$f_sha" != "$2" ]; then
    echo 1
    return 0
  fi
  if [ -z "${FORCE:-}" ]; then
    [ "${f_count:-0}" -lt 3 ] || return 1
    [ $(($(date +%s) - ${f_time:-0})) -ge 900 ] || return 1
  fi
  echo $((${f_count:-0} + 1))
}

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0 # идёт другая выкладка или ручная установка
trap 'write_status failed "выкладка прервана (остановка сервиса или перезагрузка) — продолжу на следующей проверке"; exit 143' TERM INT

deployed="$(cat "$DEPLOY_DIR/deployed-commit" 2>/dev/null || true)"

# 1. Сайт лежит (перезагрузка посреди выкладки, прерванный откат, упавший контейнер) —
#    сначала возвращаем последнюю рабочую версию.
if [ -n "$deployed" ] && ! site_healthy; then
  sleep "${HEAL_RECHECK_SECONDS:-30}" # сразу после перезагрузки контейнеры ещё запускаются
  if ! site_healthy; then
    if n="$(may_try "$DEPLOY_DIR/restore" "$deployed")"; then
      echo "$deployed $(date +%s) $n" > "$DEPLOY_DIR/restore"
      write_status building "сайт нездоров — восстанавливаю версию ${deployed:0:12} (попытка $n)"
      if run_setup "$deployed" "$DEPLOY_DIR/restore.log"; then
        rm -f "$DEPLOY_DIR/restore"
        write_status ok "сайт восстановлен: работает версия ${deployed:0:12}"
      else
        write_status failed "сайт нездоров, восстановить версию ${deployed:0:12} не удалось (попытка $n из 3)" "$DEPLOY_DIR/restore.log"
      fi
    fi
    exit 0
  fi
fi

# 2. Новый коммит в ветке — выкладываем.
remote="$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1 || true)"
[ -n "$remote" ] || { echo "нет связи с GitHub или ветки $BRANCH — пропуск"; exit 0; }
[ "$remote" != "$deployed" ] || exit 0
n="$(may_try "$DEPLOY_DIR/failed" "$remote")" || exit 0

short="${remote:0:12}"
log="$DEPLOY_DIR/last-deploy.log"
# Попытку записываем до запуска: прерванная выкладка тоже считается.
echo "$remote $(date +%s) $n" > "$DEPLOY_DIR/failed"
echo "выкладка $short (попытка $n)"
write_status building "выкладка $short (попытка $n)"
if ! timeout 300 git fetch -q origin "$BRANCH"; then
  write_status failed "не удалось скачать $short — повторю позже"
  exit 0
fi
if run_setup "$remote" "$log"; then
  rm -f "$DEPLOY_DIR/failed" "$DEPLOY_DIR/restore"
  echo "готово: $short"
  exit 0
fi

if [ -n "$deployed" ] && ! site_healthy; then
  echo "сайт не поднялся — откат на ${deployed:0:12}"
  write_status building "выкладка $short не удалась — возвращаю версию ${deployed:0:12}" "$log"
  if run_setup "$deployed" "$DEPLOY_DIR/rollback.log"; then
    write_status failed "выкладка $short не удалась, сайт возвращён на ${deployed:0:12}" "$log"
  else
    write_status failed "выкладка $short не удалась, откат на ${deployed:0:12} тоже не удался — нужен человек" "$log"
  fi
else
  write_status failed "выкладка $short не удалась, работает прежняя версия ${deployed:0:12}" "$log"
fi
echo "выкладка $short не удалась — подробности: $DEPLOY_DIR/public/deploy-status.txt"
exit 0
UPD
chmod 755 "$UPDATER_TMP"
mkdir -p "$(dirname "$UPDATER")"
mv -f "$UPDATER_TMP" "$UPDATER"

AUTO_TEXT="выключена"
if [ -d /run/systemd/system ]; then
  if [ "$AUTO_UPDATE" = 1 ]; then
    cat > /etc/systemd/system/gunraid-update.service <<EOF
[Unit]
Description=GunRaid: выкладка новых коммитов из GitHub
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$UPDATER
TimeoutStartSec=70min
Nice=5
EOF
    cat > /etc/systemd/system/gunraid-update.timer <<'EOF'
[Unit]
Description=GunRaid: проверка новых коммитов раз в минуту

[Timer]
OnBootSec=2min
OnCalendar=*-*-* *:*:00
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF
    if systemctl daemon-reload && systemctl enable --now gunraid-update.timer >/dev/null 2>&1; then
      AUTO_TEXT="включена: новые коммиты в ветке $BRANCH выкладываются сами через 1–10 минут"
    else
      AUTO_TEXT="не включилась: ошибка systemd (systemctl status gunraid-update.timer)"
    fi
  else
    systemctl disable --now gunraid-update.timer >/dev/null 2>&1 || true
  fi
elif [ "$AUTO_UPDATE" = 1 ]; then
  AUTO_TEXT="не включена: на этой системе нет systemd (запускайте $UPDATER по расписанию сами)"
fi

say "Готово: работает версия ${COMMIT:0:12}"
cat <<EOF

  Сайт:   $PUBLIC_URL${EXTRA_DOMAINS:+
  Редирект: $EXTRA_DOMAINS → $PUBLIC_URL}
  Автовыкладка $AUTO_TEXT.
  Статус выкладки: $PUBLIC_URL/deploy-status.txt
EOF
if [ "$PROTECT" != off ]; then
  # В журнал автовыкладки пароль не пишем — он хранится в $CRED_FILE.
  SHOWN_PASSWORD="$SITE_PASSWORD"
  [ -z "$MANAGED" ] || SHOWN_PASSWORD="(в $CRED_FILE)"
  cat <<EOF
  Пароль $PROTECT_TEXT — логин: $SITE_USER, пароль: $SHOWN_PASSWORD   (хранится в $CRED_FILE)
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
  Обновить вручную — запустить команду установки ещё раз (параметры запоминаются).
  Логи: cd $DIR && docker compose logs -f api worker
EOF
