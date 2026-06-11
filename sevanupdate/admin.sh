#!/usr/bin/env bash
# gbrain admin 服务启停（后台运行，不阻塞终端）
# 用法: bash sevanupdate/admin.sh start|stop|restart|status
# 端口默认 8787，可用环境变量覆盖: GBRAIN_ADMIN_PORT=9000 bash sevanupdate/admin.sh start
set -euo pipefail

PORT="${GBRAIN_ADMIN_PORT:-8787}"
STATE_DIR="$HOME/.gbrain"
PID_FILE="$STATE_DIR/admin-serve.pid"
LOG_FILE="$STATE_DIR/admin-serve.log"

running_pid() {
  # 输出存活的服务 PID；无则输出空
  local pid
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return
    fi
    rm -f "$PID_FILE" # 清理失效 pidfile
  fi
  # 兜底：接管脚本外启动的同端口实例
  pid="$(pgrep -f "gbrain serve --http --port $PORT" | head -1 || true)"
  echo "$pid"
}

start() {
  local pid
  pid="$(running_pid)"
  if [ -n "$pid" ]; then
    echo "==> admin 已在运行 (pid $pid, port $PORT)，无需启动"
    return
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "!! 端口 $PORT 已被其它进程占用：" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
    exit 1
  fi
  mkdir -p "$STATE_DIR"
  echo "==> 启动 gbrain serve --http --port ${PORT}（日志: ${LOG_FILE}）"
  nohup gbrain serve --http --port "$PORT" --suppress-bootstrap-token >>"$LOG_FILE" 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$PID_FILE"

  # 等待最多 10 秒确认端口就绪
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "!! 进程启动后退出，最近日志：" >&2
      tail -10 "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -a -p "$pid" >/dev/null 2>&1; then
      echo "==> 已启动 (pid $pid) → http://localhost:$PORT/admin/"
      return
    fi
    sleep 0.5
  done
  echo "!! 进程存活但 10 秒内端口未就绪，请查看日志: $LOG_FILE" >&2
  exit 1
}

stop() {
  local pid
  pid="$(running_pid)"
  if [ -z "$pid" ]; then
    echo "==> admin 未在运行"
    return
  fi
  echo "==> 停止 admin (pid $pid)"
  kill "$pid"
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "==> 已停止"
      return
    fi
    sleep 0.5
  done
  echo "==> 10 秒未退出，强制结束 (kill -9)"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

status() {
  local pid
  pid="$(running_pid)"
  if [ -n "$pid" ]; then
    echo "==> 运行中 (pid $pid) → http://localhost:$PORT/admin/"
  else
    echo "==> 未运行"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "用法: $0 start|stop|restart|status" >&2; exit 1 ;;
esac
