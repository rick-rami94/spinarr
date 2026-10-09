#!/bin/sh
# Builds the DVD-Video fixture matrix used by the engine and e2e tests -> test/fixtures/out/
# Needs: brew install ffmpeg dvdauthor   (full ffmpeg, for encoding test content)
set -e
cd "$(dirname "$0")"
rm -rf out; mkdir -p out/src; cd out; OUT=.
FF="ffmpeg -hide_banner -loglevel error -y"
FONT=/System/Library/Fonts/Supplemental/Arial.ttf

# clip <name> <seconds> <ntsc|pal> <aspect> <audio-spec> [subs]
clip() {
  name=$1 dur=$2 std=$3 aspect=$4 audio=$5 subs=$6
  if [ "$std" = pal ]; then size=352x288 rate=25; else size=352x240 rate=30000/1001; fi
  set -- -f lavfi -i "testsrc2=size=$size:rate=$rate:duration=$dur"
  maps="-map 0:v"
  n=1
  for a in $(echo "$audio" | tr ',' ' '); do
    ch=${a#*:}; codec=${a%%:*}
    set -- "$@" -f lavfi -i "sine=frequency=$((300 + n * 110)):duration=$dur:sample_rate=48000"
    maps="$maps -map $n:a"
    n=$((n + 1))
  done
  acodec=""
  i=0
  for a in $(echo "$audio" | tr ',' ' '); do
    ch=${a#*:}; codec=${a%%:*}
    acodec="$acodec -c:a:$i $codec -ac:a:$i $ch -b:a:$i 192k"
    i=$((i + 1))
  done
  # shellcheck disable=SC2086
  $FF "$@" $maps -target "$std-dvd" -s "$size" -b:v 400k -maxrate 2M -bufsize 1835k $acodec -aspect "$aspect" "src/$name.mpg"
  # DVD subtitles are bitmaps: render SRT text with spumux, one stream per language
  s=0
  for l in $(echo "$subs" | tr ',' ' '); do
    printf '1\n00:00:01,000 --> 00:00:04,000\nSubtitle %s\n\n2\n00:00:06,000 --> 00:00:09,000\nSecond line %s\n' "$l" "$l" > "src/$name.$l.srt"
    fmt=$(echo "$std" | tr a-z A-Z); w=${size%x*}; h=${size#*x}
    cat > "src/$name.$l.xml" <<S
<subpictures format="$fmt"><stream><textsub filename="src/$name.$l.srt" font="$FONT" fontsize="18"
  horizontal-alignment="center" vertical-alignment="bottom" movie-width="$w" movie-height="$h"/></stream></subpictures>
S
    spumux -s $s "src/$name.$l.xml" < "src/$name.mpg" > "src/$name.tmp.mpg" 2>/dev/null
    mv "src/$name.tmp.mpg" "src/$name.mpg"
    s=$((s + 1))
  done
}

author() { # author <dir> <xml>
  rm -rf "$1"; VIDEO_FORMAT=$2 dvdauthor -o "$1" -x "$3" >/dev/null 2>&1
}
iso() { # iso <dir> <file> <label>
  hdiutil makehybrid -quiet -udf -udf-volume-name "$3" -o "$2" "$1"
}

# --- ntsc_basic: 2 titles, chapters, EN/ES stereo AC3 -------------------------
clip nb1 40 ntsc 16:9 ac3:2,ac3:2
clip nb2 12 ntsc 16:9 ac3:2,ac3:2
cat > src/ntsc_basic.xml <<X
<dvdauthor><vmgm/><titleset><titles>
  <video format="ntsc" aspect="16:9"/><audio lang="en"/><audio lang="es"/>
  <pgc><vob file="src/nb1.mpg" chapters="0,0:10,0:20,0:30"/></pgc>
  <pgc><vob file="src/nb2.mpg"/></pgc>
</titles></titleset></dvdauthor>
X
author "$OUT/ntsc_basic" NTSC src/ntsc_basic.xml
iso "$OUT/ntsc_basic" "$OUT/ntsc_basic.iso" NTSC_BASIC

# --- pal_subs: PAL 4:3, 5.1 AC3 + stereo commentary, EN/FR/DE subtitles -------
clip ps1 30 pal 4:3 ac3:6,ac3:2 en,fr,de
cat > src/pal_subs.xml <<X
<dvdauthor><vmgm/><titleset><titles>
  <video format="pal" aspect="4:3"/>
  <audio lang="en"/><audio lang="en" content="comments1"/>
  <subpicture lang="en"/><subpicture lang="fr"/><subpicture lang="de"/>
  <pgc><vob file="src/ps1.mpg" chapters="0,0:15"/></pgc>
</titles></titleset></dvdauthor>
X
author "$OUT/pal_subs" PAL src/pal_subs.xml
iso "$OUT/pal_subs" "$OUT/pal_subs.iso" PAL_SUBS_WS

# --- feature_disc: 2 title sets; main feature, duplicate, trailer, logo --------
clip feat 150 ntsc 16:9 ac3:6,ac3:2
clip trailer 20 ntsc 16:9 ac3:2
clip logo 5 ntsc 4:3 mp2:2
cat > src/feature.xml <<X
<dvdauthor><vmgm/>
<titleset><titles>
  <video format="ntsc" aspect="4:3"/><audio lang="en"/>
  <pgc><vob file="src/logo.mpg"/></pgc>
</titles></titleset>
<titleset><titles>
  <video format="ntsc" aspect="16:9"/><audio lang="en"/><audio lang="ja"/>
  <pgc><vob file="src/feat.mpg" chapters="0,0:30,1:00,1:30,2:00"/></pgc>
  <pgc><vob file="src/feat.mpg" chapters="0,0:30,1:00,1:30,2:00"/></pgc>
  <pgc><vob file="src/trailer.mpg"/></pgc>
</titles></titleset>
</dvdauthor>
X
author "$OUT/feature_disc" NTSC src/feature.xml
iso "$OUT/feature_disc" "$OUT/feature_disc.iso" THE_TEST_MOVIE_DISC_1

# --- hostile: HTML/script in volume label and folder name ----------------------
iso "$OUT/ntsc_basic" "$OUT/xss_label.iso" '<img src=x onerror=__xss=1>'
mkdir -p "$OUT/<svg onload=window.__xss=2>&\"quote'"
cp -R "$OUT/ntsc_basic/VIDEO_TS" "$OUT/<svg onload=window.__xss=2>&\"quote'/"
mkdir -p "$OUT/Amélie – Ünïcødé 日本語"
cp -R "$OUT/ntsc_basic/VIDEO_TS" "$OUT/Amélie – Ünïcødé 日本語/"

# --- malformed ------------------------------------------------------------------
head -c 1048576 "$OUT/ntsc_basic.iso" > "$OUT/truncated.iso"
head -c 4194304 /dev/urandom > "$OUT/random.iso"
: > "$OUT/empty.iso"
mkdir -p "$OUT/no_videots" "$OUT/empty_videots/VIDEO_TS"
mkdir -p "$OUT/zeroed_ifo"; cp -R "$OUT/ntsc_basic/VIDEO_TS" "$OUT/zeroed_ifo/"
python3 - "$OUT/zeroed_ifo/VIDEO_TS" <<'PY'
import sys, os
d = sys.argv[1]
for f in ("VIDEO_TS.IFO", "VIDEO_TS.BUP"):
    p = os.path.join(d, f); b = bytearray(open(p, "rb").read())
    b[0x400:] = bytes(len(b) - 0x400)   # wipe tables after the header sector
    open(p, "wb").write(b)
PY
echo "fixtures -> $(pwd)"; ls "$OUT"
