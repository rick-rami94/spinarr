#!/bin/bash -eu
# ClusterFuzzLite / OSS-Fuzz build script for Spinarr's fuzz harnesses (SAFE-10).
#
# Runs inside the base-builder image with CC, CXX, CFLAGS, CXXFLAGS, LIB_FUZZING_ENGINE,
# SRC, WORK and OUT set by the image. Sources come only from `engine/build.sh fetch`
# (pinned, SHA-256 verified, Spinarr's security patches applied). libdvdread and libbluray
# are built as static libraries with the environment's sanitizer/coverage flags, then each
# harness is linked against them with $LIB_FUZZING_ENGINE.
#
# SPINARR_FUZZ_UNPATCHED=1 builds the libraries from fresh, verified copies of the same
# tarballs WITHOUT Spinarr's patches. It exists only for the sanity check that proves the
# harnesses reach the vulnerable parsers (the committed crash_* seeds must crash them).
set -euo pipefail

cd "$SRC/spinarr"

# Pinned, verified, patched sources in engine/deps/<name>-<ver>/ (tarballs kept next to them).
sh engine/build.sh fetch

PREFIX="$WORK/prefix"
rm -rf "$PREFIX"

# src_dir <name>: patched source dir, or an unpatched extraction of the verified tarball.
src_dir() {
  local name=$1 line ver sha tarball
  line=$(awk -v n="$name" '$1 == n && NF == 5' engine/build.sh)
  ver=$(echo "$line" | awk '{print $2}')
  sha=$(echo "$line" | awk '{print $4}')
  [ -n "$ver" ] && [ -n "$sha" ] || { echo "no pin for $name in engine/build.sh" >&2; exit 1; }
  if [ "${SPINARR_FUZZ_UNPATCHED:-0}" = 1 ]; then
    tarball="engine/deps/$name-$ver.tar.xz"
    echo "$sha  $tarball" | sha256sum -c - >&2
    mkdir -p "$WORK/unpatched"
    rm -rf "$WORK/unpatched/$name-$ver"
    tar xJf "$tarball" -C "$WORK/unpatched"
    echo "UNPATCHED build of $name-$ver (sanity check only)" >&2
    echo "$WORK/unpatched/$name-$ver"
  else
    echo "$SRC/spinarr/engine/deps/$name-$ver"
  fi
}

# Same feature options as engine/build.sh. --buildtype=plain keeps meson from adding its own
# optimisation flags, so CFLAGS from the CFLite environment (sanitizers, coverage) are what
# compile the library. -Db_lundef=false: sanitizer runtimes are resolved at final link.
meson_static() {
  local src=$1 build=$2; shift 2
  rm -rf "$build"
  meson setup "$build" "$src" --prefix="$PREFIX" --libdir=lib --default-library=static \
    --buildtype=plain -Db_ndebug=false -Db_lundef=false "$@"
  ninja -C "$build" install
}

meson_static "$(src_dir libdvdread)" "$WORK/build-libdvdread" -Dlibdvdcss=disabled
meson_static "$(src_dir libbluray)" "$WORK/build-libbluray" \
  -Dbdj_jar=disabled -Dfontconfig=disabled -Dfreetype=disabled -Dlibxml2=disabled \
  -Denable_tools=false -Denable_docs=false -Denable_examples=false -Denable_devtools=false \
  -Dembed_udfread=true

export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

# link_harness <target> <scanner> <pkg>: compile C with $CC, link with $CXX (libFuzzer is C++).
link_harness() {
  local target=$1 scanner=$2 pkg=$3 obj="$WORK/obj-$1"
  mkdir -p "$obj"
  # shellcheck disable=SC2046,SC2086
  $CC $CFLAGS -DSPINARR_FUZZ -I engine -I "$PREFIX/include" $(pkg-config --cflags "$pkg") \
    -c "fuzz/$target.c" -o "$obj/harness.o"
  # shellcheck disable=SC2046,SC2086
  $CC $CFLAGS -DSPINARR_FUZZ -I engine -I "$PREFIX/include" $(pkg-config --cflags "$pkg") \
    -c "engine/$scanner.c" -o "$obj/scanner.o"
  # shellcheck disable=SC2046,SC2086
  $CXX $CXXFLAGS "$obj/harness.o" "$obj/scanner.o" -o "$OUT/$target" \
    $LIB_FUZZING_ENGINE $(pkg-config --static --libs "$pkg")
  cp "fuzz/$target.options" "$OUT/"
}

link_harness fuzz_dvd_ifo dvdinfo dvdread
link_harness fuzz_bd_mpls_clpi bdinfo libbluray

# <target>_seed_corpus.zip in $OUT is picked up as the initial corpus.
python3 fuzz/make_seeds.py --out "$WORK/seeds" --zip "$OUT"
