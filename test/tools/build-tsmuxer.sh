#!/bin/sh
# Builds tsMuxeR (test-only: authors Blu-ray fixtures) from pinned, checksum-verified source.
# Needs: cmake, freetype and zlib (brew: usually present; apt: cmake libfreetype-dev zlib1g-dev).
set -eu
cd "$(dirname "$0")"
V=2.7.0
SHA=9ec281325ed5e2083720f0aa8ab628b5da4f97e215466d77b42ac965bc8c3ea7
BIN="tsMuxer-$V/build/tsMuxer/tsmuxer"
[ -x "$BIN" ] && { echo "$BIN"; exit 0; }
[ -f "tsMuxer-$V.tar.gz" ] || curl -fsSL --proto '=https' "https://github.com/justdan96/tsMuxer/archive/refs/tags/$V.tar.gz" -o "tsMuxer-$V.tar.gz"
if command -v sha256sum >/dev/null; then SUM=sha256sum; else SUM="shasum -a 256"; fi
echo "$SHA  tsMuxer-$V.tar.gz" | $SUM -c - >&2
rm -rf "tsMuxer-$V" && tar xzf "tsMuxer-$V.tar.gz"
cmake -S "tsMuxer-$V" -B "tsMuxer-$V/build" -DCMAKE_BUILD_TYPE=Release -DTSMUXER_GUI=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
cmake --build "tsMuxer-$V/build" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" >/dev/null
echo "$BIN"
