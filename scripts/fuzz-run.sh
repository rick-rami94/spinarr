#!/bin/sh
# Single entry point for running Spinarr's fuzz targets (SAFE-10, D-09/D-10/D-11).
#
#   sh scripts/fuzz-run.sh --mode code-change|batch|prune|coverage --seconds <per-target>
#        --build-out <dir> --corpus <dir> --crashes <dir> --log <file> [--report <dir>]
#
# Runs ClusterFuzzLite's own run-fuzzers image in standalone mode (CFL_PLATFORM=standalone,
# FILESTORE=filesystem): the plan 02-08 spike showed it fuzzes, reproduces and saves crashes
# to a local filestore with no GitHub or network access. The container also runs with
# --network none, so nothing can leave the machine whatever CIFuzz tries.
#
#   <build-out>   output of the CFLite build (fuzzers, *.options, *_seed_corpus.zip).
#                 coverage mode needs a SANITIZER=coverage build-out.
#   <corpus>      <corpus>/<target>/ is read before the run and updated after it.
#   <crashes>     each crashing input goes to <crashes>/<target>/<name>, its sanitizer
#                 output to <crashes>/<target>/<name>.log.
#   <log>         ALL fuzzer and runner output (stack traces included) is appended here.
#   <report>      coverage mode: text summary in <report>/summary.txt, HTML report next to it.
#
# stdout is exactly one line: "fuzz-run: mode=<m> targets=<n> crashes=<k>".
# Exit 0 = no crash, 3 = at least one crash, anything else = infrastructure failure.
#
# Code-change mode uses CIFuzz's code-change runner when the repo containing this script is
# a plain git checkout (CI). Otherwise (e.g. a git worktree, whose .git is a pointer file the
# container cannot follow) it runs as batch with the same budget, so D-11's PR time limit holds.
# No build is ever stored in the filestore, so every crash counts as newly introduced.
set -eu
ulimit -c 0

# ClusterFuzzLite run-fuzzers image, pinned by digest (Pitfall 11). Taken from tag
# gcr.io/oss-fuzz-base/clusterfuzzlite-run-fuzzers:v1 on 2026-10-12. To bump: docker pull the
# tag, `docker inspect --format '{{index .RepoDigests 0}}'` it, re-run the plan 02-08 checks.
IMAGE=gcr.io/oss-fuzz-base/clusterfuzzlite-run-fuzzers@sha256:5b76a5350444a73b1416f12b008342ae15d31d0581e3c26589f3aa0a8fd57c27

usage() { echo "usage: sh scripts/fuzz-run.sh --mode code-change|batch|prune|coverage --seconds N --build-out DIR --corpus DIR --crashes DIR --log FILE [--report DIR]" >&2; exit 2; }

MODE= SECONDS_PER_TARGET= BUILD_OUT= CORPUS= CRASHES= LOG= REPORT=
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || usage
  case $1 in
    --mode) MODE=$2 ;;
    --seconds) SECONDS_PER_TARGET=$2 ;;
    --build-out) BUILD_OUT=$2 ;;
    --corpus) CORPUS=$2 ;;
    --crashes) CRASHES=$2 ;;
    --log) LOG=$2 ;;
    --report) REPORT=$2 ;;
    *) usage ;;
  esac
  shift 2
done
case $MODE in code-change|batch|prune|coverage) ;; *) usage ;; esac
case $SECONDS_PER_TARGET in ''|*[!0-9]*) usage ;; esac
[ "$SECONDS_PER_TARGET" -gt 0 ] || usage
[ -n "$BUILD_OUT" ] && [ -n "$CORPUS" ] && [ -n "$CRASHES" ] && [ -n "$LOG" ] || usage
[ "$MODE" != coverage ] || [ -n "$REPORT" ] || usage
[ -d "$BUILD_OUT" ] || { echo "fuzz-run: no build-out directory: $BUILD_OUT" >&2; exit 2; }

abspath() { (cd "$1" && pwd -P); }
mkdir -p "$CORPUS" "$CRASHES" "$(dirname "$LOG")"
BUILD_OUT=$(abspath "$BUILD_OUT"); CORPUS=$(abspath "$CORPUS"); CRASHES=$(abspath "$CRASHES")
LOG="$(abspath "$(dirname "$LOG")")/$(basename "$LOG")"
if [ -n "$REPORT" ]; then mkdir -p "$REPORT"; REPORT=$(abspath "$REPORT"); fi
REPO=$(abspath "$(dirname "$0")/..")

log() { echo "fuzz-run: $*" >> "$LOG"; }

# Fuzz targets: executables in build-out that carry the libFuzzer entry point.
TARGETS=
for f in "$BUILD_OUT"/*; do
  [ -f "$f" ] && [ -x "$f" ] || continue
  grep -q LLVMFuzzerTestOneInput "$f" 2>/dev/null || continue
  TARGETS="$TARGETS $(basename "$f")"
done
N=$(echo $TARGETS | wc -w | tr -d ' ')
[ "$N" -gt 0 ] || { log "no fuzz targets in $BUILD_OUT"; echo "fuzz-run: mode=$MODE targets=0 crashes=0"; exit 1; }

RUN=$(mktemp -d "${FUZZ_RUN_TMP:-${TMPDIR:-/tmp}}/fuzz-run.XXXXXX")
RUN=$(abspath "$RUN")
trap 'rm -rf "$RUN"' EXIT
trap 'exit 1' INT TERM
mkdir -p "$RUN/workspace" "$RUN/filestore/corpus"
cp -R "$BUILD_OUT" "$RUN/workspace/build-out"

# Seed the filestore with the persistent corpus, in the layout FilesystemFilestore reads.
for t in $TARGETS; do
  mkdir -p "$CORPUS/$t" "$RUN/filestore/corpus/$t"
  cp -R "$CORPUS/$t/." "$RUN/filestore/corpus/$t/"
done

# CFLite splits FUZZ_SECONDS across targets, so give it the per-target budget times N.
FUZZ_SECONDS=$((SECONDS_PER_TARGET * N))
CFL_MODE=$MODE SANITIZER=address SRC_MOUNT=
case $MODE in
  coverage) SANITIZER=coverage ;;
  code-change)
    if [ -d "$REPO/.git" ]; then
      SRC_MOUNT="-v $REPO:/src/spinarr:ro -e PROJECT_SRC_PATH=/src/spinarr"
    else
      CFL_MODE=batch
      log "code-change: $REPO is not a plain git checkout, running batch mode with the same budget"
    fi ;;
esac

log "mode=$MODE (cflite $CFL_MODE) targets=$TARGETS fuzz_seconds=$FUZZ_SECONDS image=$IMAGE"
set +e
# shellcheck disable=SC2086
docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$RUN/workspace:/workspace" -v "$RUN/filestore:/filestore" $SRC_MOUNT \
  -e CFL_PLATFORM=standalone -e FILESTORE=filesystem -e FILESTORE_ROOT_DIR=/filestore \
  -e WORKSPACE=/workspace -e REPOSITORY=spinarr -e LANGUAGE=c \
  -e MODE="$CFL_MODE" -e FUZZ_SECONDS="$FUZZ_SECONDS" -e SANITIZER="$SANITIZER" \
  --entrypoint python3 "$IMAGE" /opt/oss-fuzz/infra/cifuzz/run_fuzzers_entrypoint.py \
  >> "$LOG" 2>&1
RC=$?
set -e
log "run-fuzzers exit status $RC"

# Persist the updated corpus (prune replaces it in the filestore; batch adds to it).
for t in $TARGETS; do
  if [ -d "$RUN/filestore/corpus/$t" ]; then
    rm -rf "$CORPUS/$t"; mkdir -p "$CORPUS/$t"
    cp -R "$RUN/filestore/corpus/$t/." "$CORPUS/$t/"
  fi
done

# Move crash inputs and their sanitizer output into <crashes>/<target>/.
K=0
for t in $TARGETS; do
  for c in "$RUN"/filestore/crashes/"$t"/*/*; do
    [ -f "$c" ] || continue
    case $c in *.summary) continue ;; esac
    name=$(basename "$c")
    mkdir -p "$CRASHES/$t"
    cp "$c" "$CRASHES/$t/$name"
    if [ -f "$c.summary" ]; then cp "$c.summary" "$CRASHES/$t/$name.log"; else : > "$CRASHES/$t/$name.log"; fi
    K=$((K + 1))
  done
done

if [ "$MODE" = coverage ] && [ $RC -eq 0 ]; then
  if [ -d "$RUN/workspace/cifuzz-coverage" ]; then
    cp -R "$RUN/workspace/cifuzz-coverage/." "$REPORT/"
  fi
  SUMMARY_JSON=$(find "$REPORT" -name summary.json -path '*linux*' 2>/dev/null | head -n 1)
  if [ -n "$SUMMARY_JSON" ]; then
    python3 - "$SUMMARY_JSON" > "$REPORT/summary.txt" <<'EOF'
import json, sys
totals = json.load(open(sys.argv[1]))['data'][0]['totals']
print('Spinarr fuzz coverage (llvm-cov totals over all fuzz targets)')
for kind in ('lines', 'functions', 'regions', 'branches'):
    t = totals.get(kind)
    if t:
        print(f"{kind:10s} {t['covered']:>7}/{t['count']:<7} {t['percent']:6.2f}%")
EOF
  else
    log "coverage: no summary.json produced"; RC=1
  fi
fi

echo "fuzz-run: mode=$MODE targets=$N crashes=$K"
if [ $K -gt 0 ]; then exit 3; fi
# 2 from CIFuzz means "bug found"; with no crash file that is an infrastructure problem.
if [ $RC -ne 0 ]; then exit 1; fi
exit 0
