#!/usr/bin/env bash
# Finance 관리 스크립트
# 사용법: finance.sh {start|stop|restart|status|logs|dev}

set -euo pipefail

PROJECT_DIR="/home/leedw/projects/finance"
PID_FILE="$PROJECT_DIR/.finance.pid"
LOG_FILE="$PROJECT_DIR/.finance.log"
PORT=3000

cd "$PROJECT_DIR"

case "${1:-help}" in
  start)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "이미 실행 중입니다 (PID: $(cat "$PID_FILE"))"
      exit 1
    fi
    echo "Starting finance on port $PORT..."
    nohup pnpm dev --turbo >"$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID >"$PID_FILE"
    echo "시작됨 (PID: $PID)"
    echo "로그: tail -f $LOG_FILE"
    # 포트 바인딩 대기
    for i in {1..30}; do
      if ss -tln | grep -q ":$PORT "; then
        echo "서버 준비 완료: http://localhost:$PORT"
        exit 0
      fi
      sleep 0.5
    done
    echo "경고: 포트 $PORT 바인딩 확인 안 됨 (계속 시작 중일 수 있음)"
    ;;

  stop)
    # PID 파일(pnpm)이 stale이어도 실제 next 프로세스와 포트 점유 프로세스까지 정리
    PIDS=""
    [[ -f "$PID_FILE" ]] && PIDS="$(cat "$PID_FILE")"
    PIDS="$PIDS $(pgrep -f "$PROJECT_DIR/node_modules/.*next dev" || true)"
    PIDS="$PIDS $(ss -tlnpH "sport = :$PORT" | grep -oP 'pid=\K[0-9]+' || true)"
    PIDS=$(echo $PIDS | tr ' ' '\n' | sort -u | tr '\n' ' ')
    PIDS="${PIDS% }"
    if [[ -n "${PIDS:-}" ]]; then
      for pid in $PIDS; do
        if kill -0 "$pid" 2>/dev/null; then
          echo "중지 중: $pid"
          kill -TERM "$pid" 2>/dev/null || true
          sleep 1
          kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
        fi
      done
      echo "중지됨"
    else
      echo "실행 중인 finance 프로세스 없음"
    fi
    rm -f "$PID_FILE"
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  status)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "🟢 실행 중 (PID: $(cat "$PID_FILE"))"
      ss -tlnp | grep ":$PORT " || echo "  포트 $PORT 바인딩 안 됨"
    else
      # 프로세스 직접 검색
      PIDS=$(pgrep -f "next.*dev.*turbo")
      if [[ -n "$PIDS" ]]; then
        echo "🟡 실행 중 (PID 파일 없음):"
        for pid in $PIDS; do
          echo "  PID: $pid"
        done
      else
        echo "🔴 중지됨"
      fi
    fi
    ;;

  logs)
    if [[ -f "$LOG_FILE" ]]; then
      tail -f "$LOG_FILE"
    else
      echo "로그 파일 없음: $LOG_FILE"
      echo "시작 후 생김"
    fi
    ;;

  dev)
    # 포그라운드 개발 모드 (Ctrl+C로 종료)
    echo "개발 모드 실행 (Ctrl+C 종료)..."
    pnpm dev
    ;;

  *)
    cat <<EOF
사용법: finance.sh {start|stop|restart|status|logs|dev}

  start   - 백그라운드에서 개발 서버 시작 (nohup)
  stop    - 실행 중인 서버 중지
  restart - 재시작
  status  - 실행 상태 확인
  logs    - 실시간 로그 확인 (tail -f)
  dev     - 포그라운드 개발 모드 (기존 방식)

파일:
  PID:  $PID_FILE
  Log:  $LOG_FILE
  Port: $PORT
EOF
    ;;
esac