#!/usr/bin/env bash
# ============================================================================
# 一键启动：阳光新城 · 市政工程数字化 Demo（单端口对外）
#   ./start.sh          构建前端（如需要）+ 启动服务
#   ./start.sh --dev    开发模式（Vite 热更新 5173 + 后端 8787）
#   ./start.sh --rebuild 强制重新构建前端与场景数据
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-start}"
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8787)"
PORT="${PORT:-8787}"

say() { printf '\033[36m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 环境检查 ----------
command -v node >/dev/null 2>&1 || die "未找到 Node.js，请先安装 Node 20+"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || warn "当前 Node 版本为 $(node -v)，建议 20 或以上"

# ---------- .env ----------
if [ ! -f .env ]; then
  say "未找到 .env，从 .env.example 复制一份"
  cp .env.example .env
fi
if grep -qE '^LLM_API_KEY=$' .env; then
  warn "提示：.env 中未配置 LLM_API_KEY，Agent 将使用离线规则引擎（功能可用，效果略弱）"
fi

# ---------- 依赖 ----------
if [ ! -d node_modules ]; then
  say "安装依赖（首次运行，约 1 分钟）…"
  npm install --no-audit --no-fund
fi

# ---------- 数据 ----------
if [ ! -f public/data/site.json ] || [ "$MODE" = "--rebuild" ]; then
  say "生成场景数据…"
  npm run data:build
fi

# ---------- 前端 ----------
if [ "$MODE" = "--dev" ]; then
  say "开发模式启动：Vite(5173) + 后端(${PORT})"
  exec npm run dev
fi

if [ ! -f apps/web/dist/index.html ] || [ "$MODE" = "--rebuild" ]; then
  say "构建前端（首次约 20 秒）…"
  npm run build
fi

# ---------- 启动 ----------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "启动服务 …"
echo "  本机访问：    http://127.0.0.1:${PORT}"
[ -n "${IP:-}" ] && echo "  局域网/远程： http://${IP}:${PORT}"
echo "  停止服务：    Ctrl + C"
echo
exec npm run start
