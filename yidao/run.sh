#!/bin/bash
# 医道学堂启动脚本
# 本地运行：./run.sh（默认 8700 端口）
# 发布环境自动注入 PORT，自动适配
cd "$(dirname "$0")"
python3 -m pip install -q -r requirements.txt 2>/dev/null || pip3 install -q -r requirements.txt 2>/dev/null
PORT="${PORT:-8700}"
echo "医道学堂启动中… 端口 $PORT"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
