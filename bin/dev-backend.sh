#!/usr/bin/env bash
# 启动 backend（自动加载 .env + 设 Java 21 + 改 mysql/redis 端口为 docker 的 3307/6380）
set -e
cd "$(dirname "$0")/.."

# 加载 .env 但**不覆盖**已存在的环境变量；
# 这样 `FOO=x bash bin/dev-backend.sh` 时 FOO=x 不会被 .env 覆盖。
# 注意：.env 中可能存在跨多行的单/双引号值（如 PEM 密钥），需要累积续行。
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
      # 去掉前导空白
      logical="${logical#"${logical%%[![:space:]]*}"}"
      # 跳过空行与注释
      [ -z "$logical" ] && continue
      case "$logical" in \#*) continue ;; esac
      # 必须是 KEY=VALUE 格式
      case "$logical" in
        *=*) ;;
        *) continue ;;
      esac
      # 检查 value 是否以未闭合的引号开头（多行值）
      local v_check="${logical#*=}"
      case "$v_check" in
        "'"*"'") ;;                                   # 单行闭合
        '"'*'"') ;;                                   # 单行闭合
        "'"*) pending_quote="'"; continue ;;          # 等待闭合的 '
        '"'*) pending_quote='"'; continue ;;          # 等待闭合的 "
      esac
    fi
    # 此处 logical 已是完整逻辑行
    key="${logical%%=*}"
    value="${logical#*=}"
    # 修剪 key 两端空白
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    [ -z "$key" ] && continue
    # 已设置（即便为空）则跳过 —— 这就是“不覆盖”的关键
    if [ -n "${!key+x}" ]; then
      logical=""
      continue
    fi
    # 去掉行尾 CR（Windows 换行）
    value="${value%$'\r'}"
    # 去掉首尾成对引号
    case "$value" in
      '"'*'"') value="${value%\"}"; value="${value#\"}" ;;
      "'"*"'") value="${value%\'}"; value="${value#\'}" ;;
    esac
    export "$key=$value"
    logical=""
  done < "$file"
}

if [ -f .env ]; then
  _load_env_no_override .env
else
  echo "❌ .env 不存在，请先 cp .env.example .env 并填值"
  exit 1
fi

export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:$PATH"

echo "✓ JAVA_HOME=$JAVA_HOME"
echo "✓ MYSQL: $MYSQL_HOST:$MYSQL_PORT  REDIS: $REDIS_HOST:$REDIS_PORT"
echo "✓ 启动 backend on :$APP_PORT ..."

cd backend-api && exec mvn spring-boot:run
