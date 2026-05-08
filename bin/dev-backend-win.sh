#!/usr/bin/env bash
# Windows 版：复用 dev-backend.sh 的 .env 加载逻辑，但不强行改 JAVA_HOME
set -e
cd "$(dirname "$0")/.."

_load_env_no_override() {
  local file="$1"
  [ -f "$file" ] || { echo "❌ $file not found"; return 1; }
  local raw key value pending_quote="" logical=""
  while IFS= read -r raw || [ -n "$raw" ]; do
    if [ -n "$pending_quote" ]; then
      logical="$logical"$'\n'"$raw"
      case "$raw" in
        *"$pending_quote"*) pending_quote="" ;;
      esac
      [ -n "$pending_quote" ] && continue
    else
      logical="$raw"
      logical="${logical#"${logical%%[![:space:]]*}"}"
      [ -z "$logical" ] && continue
      case "$logical" in \#*) continue ;; esac
      case "$logical" in
        *=*) ;;
        *) continue ;;
      esac
      local v_check="${logical#*=}"
      case "$v_check" in
        "'"*"'") ;;
        '"'*'"') ;;
        "'"*) pending_quote="'"; continue ;;
        '"'*) pending_quote='"'; continue ;;
      esac
    fi
    key="${logical%%=*}"
    value="${logical#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    [ -z "$key" ] && continue
    if [ -n "${!key+x}" ]; then
      logical=""
      continue
    fi
    value="${value%$'\r'}"
    case "$value" in
      '"'*'"') value="${value%\"}"; value="${value#\"}" ;;
      "'"*"'") value="${value%\'}"; value="${value#\'}" ;;
    esac
    export "$key=$value"
    logical=""
  done < "$file"
}

_load_env_no_override .env

export SPRING_PROFILES_ACTIVE=dev
echo "✓ MYSQL: $MYSQL_HOST:$MYSQL_PORT  REDIS: $REDIS_HOST:$REDIS_PORT"
echo "✓ 启动 backend on :$APP_PORT ..."

cd backend-api && exec mvn spring-boot:run
