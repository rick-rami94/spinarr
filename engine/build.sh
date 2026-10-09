#!/bin/sh
# Builds Spinarr's rip engine into engine/bin/:
#   ffmpeg, ffprobe  remux-only ffmpeg with the DVD-Video demuxer
#   dvdinfo          one-pass DVD title scanner (engine/dvdinfo.c)
# libdvdread and libdvdnav are built from pinned, checksum-verified sources with
# Spinarr's security patches and linked statically. libbluray is built the same way, with
# BD-J (Java), fonts and XML disabled. Decryption libraries are NOT bundled: libdvdcss,
# libaacs and libbdplus are loaded at runtime only if the user installed them.
#
# Needs: brew install meson ninja nasm pkg-config
set -eu
cd "$(dirname "$0")"
ROOT=$(pwd)
DEPS="$ROOT/deps"
PREFIX="$DEPS/prefix"
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
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
  stamp="$dir/.spinarr-$(cat "$ROOT"/patches/"$1"-*.patch 2>/dev/null | shasum -a 256 | cut -c1-16)"
  if [ -f "$stamp" ]; then echo "$dir"; return; fi
  [ -f "$tarball" ] || curl -fsSL --proto '=https' --tlsv1.2 "$url" -o "$tarball"
  echo "$sha  $tarball" | shasum -a 256 -c - >&2 || { echo "checksum mismatch: $tarball" >&2; rm -f "$tarball"; exit 1; }
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
  --enable-gpl --enable-version3 --enable-libdvdnav --enable-libdvdread --enable-libbluray \
  --enable-demuxer=dvdvideo,mpegps,mpegts,ffmetadata,matroska,mpegvideo,h264,hevc,vc1,ac3,eac3,dts,truehd,mlp,mp3,pcm_s16be \
  --enable-muxer=matroska,null --enable-protocol=file,pipe,bluray --enable-encoder=flac \
  --enable-parser=mpegvideo,h264,hevc,vc1,ac3,dca,mlp,mpegaudio,dvdsub,dvd_nav \
  --enable-decoder=mpeg2video,mpeg1video,h264,hevc,vc1,ac3,eac3,dca,truehd,mlp,mp2,mp3,pcm_dvd,pcm_bluray,dvdsub,pgssub \
  --enable-bsf=dca_core,mpeg2_metadata,extract_extradata,pgs_frame_merge,null --enable-filter=null,anull,aformat,aresample >/dev/null
make -j"$JOBS" >/dev/null
cp ffmpeg ffprobe "$ROOT/bin/"
cd "$ROOT"

# --- dvdinfo ---
# shellcheck disable=SC2046
cc -O2 -Wall -Wextra -Wno-unused-parameter -fstack-protector-strong -D_FORTIFY_SOURCE=2 \
  -o bin/dvdinfo dvdinfo.c $(pkg-config --static --cflags --libs dvdread)
# shellcheck disable=SC2046
cc -O2 -Wall -Wextra -Wno-unused-parameter -fstack-protector-strong -D_FORTIFY_SOURCE=2 \
  -o bin/bdinfo bdinfo.c $(pkg-config --static --cflags --libs libbluray)

echo "engine built -> $ROOT/bin"
for b in ffmpeg ffprobe dvdinfo bdinfo; do otool -L "bin/$b" | tail -n +2 | grep -v '/usr/lib/\|/System/' && echo "WARNING: bin/$b links a non-system library" >&2 || true; done
