#!/bin/sh
# Builds the two fuzz harnesses with ASan+UBSan and the standalone driver, then runs each
# over every corpus seed (plus path-traversal probes) and fails on any sanitizer report.
# Local smoke run only; real fuzzing is Linux/libFuzzer in CI (plan 02-08).
#
# Needs engine/deps/prefix from `sh engine/build.sh` (patched libdvdread and libbluray).
# The libraries themselves are not instrumented here; the harness and scanner code are.
set -eu
cd "$(dirname "$0")/.."
CC=${CC:-cc}
OUT=fuzz/out
PREFIX=engine/deps/prefix
[ -f "$PREFIX/lib/libdvdread.a" ] && [ -f "$PREFIX/lib/libbluray.a" ] || {
  echo "missing $PREFIX: run sh engine/build.sh first" >&2; exit 1; }
PKG_CONFIG_PATH="$(pwd)/$PREFIX/lib/pkgconfig"; export PKG_CONFIG_PATH
mkdir -p "$OUT"

CFLAGS="-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -DSPINARR_FUZZ -I engine -I $PREFIX/include"
# shellcheck disable=SC2046,SC2086
$CC $CFLAGS -o "$OUT/fuzz_dvd_ifo" fuzz/fuzz_dvd_ifo.c engine/dvdinfo.c fuzz/standalone_main.c \
  $(pkg-config --static --cflags --libs dvdread)
# shellcheck disable=SC2046,SC2086
$CC $CFLAGS -o "$OUT/fuzz_bd_mpls_clpi" fuzz/fuzz_bd_mpls_clpi.c engine/bdinfo.c fuzz/standalone_main.c \
  $(pkg-config --static --cflags --libs libbluray)

python3 fuzz/make_seeds.py --out "$OUT/seeds"

# Path-traversal probes: memfs must drop these records and never reach the real filesystem.
mkdir -p "$OUT/adhoc/fuzz_dvd_ifo" "$OUT/adhoc/fuzz_bd_mpls_clpi"
printf '\031VIDEO_TS/../../etc/passwd\004\000\000\000root' > "$OUT/adhoc/fuzz_dvd_ifo/traversal.bin"
printf '\025BDMV/../../etc/passwd\004\000\000\000root' > "$OUT/adhoc/fuzz_bd_mpls_clpi/traversal.bin"
printf '\013/etc/passwd\004\000\000\000root' > "$OUT/adhoc/fuzz_bd_mpls_clpi/absolute.bin"

ASAN_OPTIONS=detect_leaks=0:exitcode=86; export ASAN_OPTIONS
UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1:exitcode=87; export UBSAN_OPTIONS
for t in fuzz_dvd_ifo fuzz_bd_mpls_clpi; do
  echo "== $t" >&2
  "$OUT/$t" "$OUT/seeds/$t" || { echo "$t failed on a corpus seed (exit $?)" >&2; exit 1; }
  "$OUT/$t" "$OUT/adhoc/$t" || { echo "$t failed on a path-traversal probe (exit $?)" >&2; exit 1; }
done
echo "fuzz harnesses OK" >&2
