#!/bin/sh
# Builds the GPL corresponding-source bundle for a release (D-14): sh scripts/source-bundle.sh <version> <outdir>.
# Needs git, node, curl, xz and GNU tar.
#
# The bundle is spinarr-<version>-source.tar.gz: the app source at the release ref (git archive,
# so it includes engine/build.sh, engine/patches/ and BUILDING.md), plus every upstream engine
# tarball exactly as pinned, under engine/upstream/. Output is deterministic: sorted names, mtime
# fixed to the ref's commit time, numeric root owner, and no timestamp in the gzip header.
# SPINARR_SOURCE_REF overrides the ref (default v<version>).
set -eu
umask 022
export LC_ALL=C

if [ $# -ne 2 ]; then
  echo "usage: sh scripts/source-bundle.sh <version> <outdir>" >&2
  exit 2
fi
VER=$1
OUT=$2
cd "$(dirname "$0")/.."
ROOT=$(pwd)
REF="${SPINARR_SOURCE_REF:-v$VER}"
P="spinarr-$VER"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "unknown git ref: $REF" >&2; exit 1; }
# The pins come from the working tree's engine/build.sh, so it must be the one at the ref.
if ! git diff --quiet "$REF" -- engine/build.sh; then
  echo "engine/build.sh differs from $REF; check out $REF first" >&2
  exit 1
fi
SDE=$(git log -1 --format=%ct "$REF")

TAR=tar
if command -v gtar >/dev/null; then TAR=gtar; fi
if ! $TAR --version 2>/dev/null | grep -q 'GNU tar'; then
  echo "needs GNU tar (macOS: brew install gnu-tar)" >&2
  exit 1
fi

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

# App source at the ref.
git archive --format=tar --prefix="$P/" "$REF" | $TAR -xf - -C "$WORK"

# Upstream engine sources: build.sh downloads (if needed) and verifies every pin.
sh engine/build.sh fetch

# Copy each pinned tarball and check it again against the pin table (scripts/pins.js is the
# single parser of build.sh's SOURCES block).
mkdir -p "$WORK/$P/engine/upstream"
node -e 'for (const p of require(process.argv[1]).readPins()) console.log(`${p.name}-${p.version}.tar.xz ${p.sha256}`)' \
  "$ROOT/scripts/pins.js" > "$WORK/pins.txt"
[ -s "$WORK/pins.txt" ] || { echo "no pins read from engine/build.sh" >&2; exit 1; }
while read -r file sha; do
  src="$ROOT/engine/deps/$file"
  [ -f "$src" ] || { echo "missing $src after build.sh fetch" >&2; exit 1; }
  cp "$src" "$WORK/$P/engine/upstream/$file"
  echo "$sha  $WORK/$P/engine/upstream/$file" | sha256 -c - >/dev/null \
    || { echo "checksum mismatch: $file does not match its pin" >&2; exit 1; }
done < "$WORK/pins.txt"

# Pack deterministically.
(cd "$WORK" && $TAR --sort=name --mtime="@$SDE" --owner=0 --group=0 --numeric-owner --format=gnu -cf - "$P") \
  | gzip -n -9 > "$OUT/$P-source.tar.gz"

echo "$OUT/$P-source.tar.gz"
du -h "$OUT/$P-source.tar.gz" | cut -f1
