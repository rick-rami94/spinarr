#!/bin/sh
# Runs the whole test suite on Linux in Docker: sh test/linux/run.sh [e2e scenario ...]
# --privileged lets bubblewrap create its namespaces inside the container.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -q -t spinarr-linux "$ROOT/test/linux" >/dev/null
docker volume create spinarr-linux-work >/dev/null
exec docker run --rm --privileged -e ORACLE_FFMPEG_DIR=/usr/bin -v "$ROOT":/src:ro -v spinarr-linux-work:/home/dev/spinarr spinarr-linux sh -euc '
  rsync -a --delete --exclude node_modules --exclude engine/bin --exclude "engine/deps/*/" --exclude test/fixtures/out \
    --exclude test/reports --exclude "test/tools/tsMuxer-*/" --exclude .git /src/ ./
  npm ci --no-audit --no-fund
  if [ -x engine/bin/ffmpeg ]; then sh engine/build.sh scanners; else npm run engine; fi
  [ -f test/fixtures/out/bd_movie.iso ] || npm run fixtures
  npm run test:unit
  npm run test:security
  npm run test:engine
  xvfb-run -a -s "-screen 0 1400x900x24" node test/e2e/run.js "$@"
' sh "$@"
