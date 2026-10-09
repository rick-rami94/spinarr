#!/bin/sh
# Builds the Blu-ray fixture matrix -> test/fixtures/out/bd_*
# Needs: ffmpeg with libx264, cmake (and genisoimage on Linux). tsMuxeR is built from source on first run.
set -eu
cd "$(dirname "$0")"
. ./common.sh
TSM="$(pwd)/../tools/$(sh ../tools/build-tsmuxer.sh | tail -1)"
OUT="$(pwd)/out"; SRC="$OUT/bdsrc"
rm -rf "$OUT"/bd_* "$SRC"; mkdir -p "$SRC"
FF="ffmpeg -hide_banner -loglevel error -y"

# video <name> <seconds> <WxH>
video() {
  $FF -f lavfi -i "testsrc2=size=$3:rate=24000/1001:duration=$2" -c:v libx264 -preset veryfast -tune zerolatency \
    -profile:v high -level 4.1 -bf 0 -g 24 -keyint_min 24 -b:v 2M -maxrate 4M -bufsize 4M \
    -x264-params "bluray-compat=1:slices=4:nal-hrd=vbr" -pix_fmt yuv420p -an -f h264 "$SRC/$1.h264"
}
# tone <name> <seconds> <channels> <codec> <hz>
tone() {
  case "$4" in
    ac3) $FF -f lavfi -i "sine=frequency=$5:duration=$2:sample_rate=48000" -ac "$3" -c:a ac3 -b:a 448k "$SRC/$1.ac3" ;;
    pcm) $FF -f lavfi -i "sine=frequency=$5:duration=$2:sample_rate=48000" -ac "$3" -c:a pcm_s16le "$SRC/$1.wav" ;;
  esac
}
srt() { # srt <name> <text>
  printf '1\n00:00:02,000 --> 00:00:06,000\n%s one\n\n2\n00:00:12,000 --> 00:00:16,000\n%s two\n' "$2" "$2" > "$SRC/$1.srt"
}
pgs() { # pgs <srt> <lang>
  echo "S_TEXT/UTF8, \"$SRC/$1.srt\", font-name=\"$FONT\", font-size=65, font-color=0xffffffff, bottom-offset=24, font-border=5, text-align=center, video-width=1920, video-height=1080, fps=23.976, lang=$2"
}
# mux <disc dir> <playlist/clip offset> <meta body...>
mux() {
  d=$1; off=$2; shift 2
  { echo "MUXOPT --no-pcr-on-video-pid --new-audio-pes --blu-ray --vbr --vbv-len=500 --mplsOffset=$off --m2tsOffset=$off $CHAPTERS"; printf '%s\n' "$@"; } > "$SRC/m$off.meta"
  "$TSM" "$SRC/m$off.meta" "$d" > "$SRC/m$off.log" 2>&1 || { tail -5 "$SRC/m$off.log"; exit 1; }
}

# --- media ---
video feat 90 1920x1080; tone feat_en 90 6 ac3 440; tone feat_fr 90 2 ac3 660; tone feat_pcm 90 2 pcm 550
srt feat_en "English"; srt feat_fr "Francais"
video trailer 15 1920x1080; tone trailer_en 15 2 ac3 330
video logo 4 1920x1080; tone logo_en 4 2 ac3 220

# --- bd_movie: main feature (playlist 0), duplicate playlist (1), trailer (2), logo (3) ---
D="$OUT/bd_movie"
FEAT_VIDEO="V_MPEG4/ISO/AVC, \"$SRC/feat.h264\", fps=23.976, insertSEI, contSPS"
CHAPTERS="--custom-chapters=00:00:00.000;00:00:20.000;00:00:40.000;00:01:00.000;00:01:20.000"
mux "$D" 0 "$FEAT_VIDEO" "A_AC3, \"$SRC/feat_en.ac3\", lang=eng" "A_AC3, \"$SRC/feat_fr.ac3\", lang=fre" \
  "A_LPCM, \"$SRC/feat_pcm.wav\", lang=eng" "$(pgs feat_en eng)" "$(pgs feat_fr fre)"
mux "$D" 1 "$FEAT_VIDEO" "A_AC3, \"$SRC/feat_en.ac3\", lang=eng" "A_AC3, \"$SRC/feat_fr.ac3\", lang=fre" \
  "A_LPCM, \"$SRC/feat_pcm.wav\", lang=eng" "$(pgs feat_en eng)" "$(pgs feat_fr fre)"
CHAPTERS=""
mux "$D" 2 "V_MPEG4/ISO/AVC, \"$SRC/trailer.h264\", fps=23.976, insertSEI, contSPS" "A_AC3, \"$SRC/trailer_en.ac3\", lang=eng"
mux "$D" 3 "V_MPEG4/ISO/AVC, \"$SRC/logo.h264\", fps=23.976, insertSEI, contSPS" "A_AC3, \"$SRC/logo_en.ac3\", lang=eng"
mkiso MY_TEST_MOVIE "$OUT/bd_movie.iso" "$D" 2.50

# --- encrypted-looking disc: AACS directory present, no libaacs/keys -> must be reported, not crash ---
cp -R "$D" "$OUT/bd_aacs"; mkdir -p "$OUT/bd_aacs/AACS"
head -c 2048 /dev/urandom > "$OUT/bd_aacs/AACS/Unit_Key_RO.inf"; head -c 1024 /dev/urandom > "$OUT/bd_aacs/AACS/MKB_RO.inf"

# --- hostile / malformed ---
mkiso '<img src=x onerror=__xss=3>' "$OUT/bd_xss_label.iso" "$D" 2.50
cp -R "$D" "$OUT/bd_truncated_mpls"; for f in "$OUT"/bd_truncated_mpls/BDMV/PLAYLIST/*.mpls "$OUT"/bd_truncated_mpls/BDMV/BACKUP/PLAYLIST/*.mpls; do head -c 60 "$f" > "$f.t" && mv "$f.t" "$f"; done
mkdir -p "$OUT/bd_empty/BDMV"
echo "blu-ray fixtures -> $OUT/bd_*"; ls -d "$OUT"/bd_*
