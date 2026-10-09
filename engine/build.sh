#!/bin/sh
# Builds Spinarr's rip engine into engine/bin/:
#   ffmpeg, ffprobe  remux-only ffmpeg with the DVD-Video demuxer
#   dvdinfo          one-pass DVD title scanner (engine/dvdinfo.c)
# libdvdread and libdvdnav are built from pinned, checksum-verified sources with
# Spinarr's security patches and linked statically. libbluray is built the same way, with
# BD-J (Java), fonts and XML disabled. Decryption libraries are NOT bundled: libdvdcss,
# libaacs and libbdplus are loaded at runtime only if the user installed them.
#
# Needs a C toolchain plus meson, ninja, nasm, pkg-config, curl, patch and xz:
#   macOS:   xcode-select --install && brew install meson ninja nasm pkg-config
#   Linux:   sudo apt install build-essential meson ninja-build nasm pkg-config curl patch xz-utils
#   Windows: MSYS2 MINGW64 (or CLANGARM64) shell:
#            pacman -S --needed make patch tar xz curl mingw-w64-x86_64-{gcc,meson,ninja,nasm,pkgconf}
set -eu
cd "$(dirname "$0")"
ROOT=$(pwd)
DEPS="$ROOT/deps"
PREFIX="$DEPS/prefix"
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
CC=${CC:-cc}
case "$(uname -s)" in
  Darwin) OS=mac; EXE= ;;
  MINGW*|MSYS*|CYGWIN*) OS=win; EXE=.exe ;;
  *) OS=linux; EXE= ;;
esac
# Windows: link everything statically, so the .exe files need no MinGW runtime DLLs.
STATIC_LD=; if [ $OS = win ]; then STATIC_LD=-static; fi
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
mkdir -p bin "$DEPS"

# name  version  url  sha256
# ffmpeg's PGP signature was checked against FFmpeg release key
# FCF986EA15E6E293A5644F10B4322F04D67658D8 when this pin was set. The videolan
# hashes match the .sha256 files published next to each tarball.
SOURCES="
ffmpeg 8.0.1 https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz 05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41
libdvdread 7.1.1 https://download.videolan.org/pub/videolan/libdvdread/7.1.1/libdvdread-7.1.1.tar.xz a0d47876548bec806774bbf8dbf20bb19ba139464383156b32eb8e59915b90a9
libdvdnav 7.0.0 https://download.videolan.org/pub/videolan/libdvdnav/7.0.0/libdvdnav-7.0.0.tar.xz a2a18f5ad36d133c74bf9106b6445806fa253b09141a46392550394b647b221e
libbluray 1.5.0 https://download.videolan.org/pub/videolan/libbluray/1.5.0/libbluray-1.5.0.tar.xz f676408e91a5d321abf8b8d4dfdae36205c297dab5c54c3ec519639025f474a2
"

# fetch <name>: download, verify, extract fresh into deps/<name>-<ver>, apply patches/<name>-*.patch
fetch() {
  line=$(echo "$SOURCES" | awk -v n="$1" '$1 == n')
  ver=$(echo "$line" | awk '{print $2}'); url=$(echo "$line" | awk '{print $3}'); sha=$(echo "$line" | awk '{print $4}')
  dir="$DEPS/$1-$ver"; tarball="$DEPS/$1-$ver.tar.xz"
  stamp="$dir/.spinarr-$(cat "$ROOT"/patches/"$1"-*.patch 2>/dev/null | sha256 | cut -c1-16)"
  if [ -f "$stamp" ]; then echo "$dir"; return; fi
  [ -f "$tarball" ] || curl -fsSL --proto '=https' --tlsv1.2 "$url" -o "$tarball"
  echo "$sha  $tarball" | sha256 -c - >&2 || { echo "checksum mismatch: $tarball" >&2; rm -f "$tarball"; exit 1; }
  rm -rf "$dir"
  tar xJf "$tarball" -C "$DEPS"
  for p in "$ROOT"/patches/"$1"-*.patch; do
    [ -f "$p" ] || continue
    echo "applying $(basename "$p")" >&2
    patch -d "$dir" -p1 --forward --quiet < "$p"
  done
  touch "$stamp"
  echo "$dir"
}

export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

# `build.sh scanners` rebuilds only dvdinfo/bdinfo against the already-built libraries.
if [ "${1:-}" != scanners ]; then

# --- libdvdread / libdvdnav (static, asserts kept on: they stop libdvdnav on bad cell data) ---
for lib in libdvdread libdvdnav; do
  src=$(fetch $lib)
  rm -rf "$src/build"
  meson setup "$src/build" "$src" --prefix="$PREFIX" --libdir=lib --default-library=static \
    --buildtype=release -Db_ndebug=false $( [ $lib = libdvdread ] && echo -Dlibdvdcss=disabled ) >/dev/null
  ninja -C "$src/build" install >/dev/null
done

# --- libbluray (static; no Java/BD-J, fonts or XML: Spinarr only needs playlists and streams) ---
src=$(fetch libbluray)
rm -rf "$src/build"
meson setup "$src/build" "$src" --prefix="$PREFIX" --libdir=lib --default-library=static \
  --buildtype=release -Db_ndebug=false -Dbdj_jar=disabled -Dfontconfig=disabled -Dfreetype=disabled \
  -Dlibxml2=disabled -Denable_tools=false -Denable_docs=false -Denable_examples=false \
  -Denable_devtools=false -Dembed_udfread=true >/dev/null
ninja -C "$src/build" install >/dev/null

# --- ffmpeg (remux only) ---
src=$(fetch ffmpeg)
cd "$src"
./configure \
  --pkg-config-flags=--static \
  --disable-everything --disable-doc --disable-ffplay --disable-network \
  --disable-autodetect --disable-shared --enable-static \
  $( [ $OS = win ] && echo --enable-w32threads --extra-ldflags=-static ) \
  --enable-gpl --enable-version3 --enable-libdvdnav --enable-libdvdread --enable-libbluray \
  --enable-demuxer=dvdvideo,mpegps,mpegts,ffmetadata,matroska,mpegvideo,h264,hevc,vc1,ac3,eac3,dts,truehd,mlp,mp3,pcm_s16be \
  --enable-muxer=matroska,null --enable-protocol=file,pipe,bluray --enable-encoder=flac \
  --enable-parser=mpegvideo,h264,hevc,vc1,ac3,dca,mlp,mpegaudio,dvdsub,dvd_nav \
  --enable-decoder=mpeg2video,mpeg1video,h264,hevc,vc1,ac3,eac3,dca,truehd,mlp,mp2,mp3,pcm_dvd,pcm_bluray,dvdsub,pgssub \
  --enable-bsf=dca_core,mpeg2_metadata,extract_extradata,pgs_frame_merge,null --enable-filter=null,anull,aformat,aresample >/dev/null
make -j"$JOBS" >/dev/null
cp "ffmpeg$EXE" "ffprobe$EXE" "$ROOT/bin/"
cd "$ROOT"

fi

# --- dvdinfo / bdinfo ---
WINLIBS=; if [ $OS = win ]; then WINLIBS=-lshell32; fi
# shellcheck disable=SC2046,SC2086
$CC -O2 -Wall -Wextra -Wno-unused-parameter -fstack-protector-strong -D_FORTIFY_SOURCE=2 $STATIC_LD \
  -o "bin/dvdinfo$EXE" dvdinfo.c $(pkg-config --static --cflags --libs dvdread) $WINLIBS
# shellcheck disable=SC2046,SC2086
$CC -O2 -Wall -Wextra -Wno-unused-parameter -fstack-protector-strong -D_FORTIFY_SOURCE=2 $STATIC_LD \
  -o "bin/bdinfo$EXE" bdinfo.c $(pkg-config --static --cflags --libs libbluray) $WINLIBS

echo "engine built -> $ROOT/bin"
# Each binary may only link the OS's own libraries: everything else is static.
for b in ffmpeg ffprobe dvdinfo bdinfo; do
  f="bin/$b$EXE"
  case $OS in
    mac) bad=$(otool -L "$f" | tail -n +2 | grep -v '/usr/lib/\|/System/' || true) ;;
    linux) bad=$(ldd "$f" 2>/dev/null | grep -v 'linux-vdso\|ld-linux\|libc\.so\|libm\.so\|libdl\.so\|libpthread\.so\|librt\.so\|statically linked' || true) ;;
    win) bad=$(objdump -p "$f" | sed -n 's/^\s*DLL Name: //p' | grep -iv '^\(kernel32\|user32\|advapi32\|shell32\|ole32\|ws2_32\|bcrypt\|msvcrt\|ucrtbase\|api-ms-win-.*\|shlwapi\|secur32\|gdi32\|psapi\)\.dll' || true) ;;
  esac
  [ -z "$bad" ] || echo "WARNING: $f links a non-system library: $bad" >&2
done
