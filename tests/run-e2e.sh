#!/usr/bin/env bash
# Starts the test harness, runs the Playwright suite, stops the harness.
cd "$(dirname "$0")/.." || exit 1
PORT=8790 node tests/dev-server.mjs >/tmp/lumen-dev.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null localhost:8790/ && break; sleep 0.2; done
python3 tests/e2e.py
