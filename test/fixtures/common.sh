# Shared by the fixture scripts. Works on macOS (hdiutil) and Linux (genisoimage).

# A font for rendering subtitle text.
for FONT in /System/Library/Fonts/Supplemental/Arial.ttf /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
  /usr/share/fonts/TTF/DejaVuSans.ttf /usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf; do
  [ -f "$FONT" ] && break
done

# mkiso <label> <out.iso> <dir> [udf-version]: a UDF disc image of <dir>.
mkiso() {
  if command -v hdiutil >/dev/null 2>&1; then
    hdiutil makehybrid -quiet -udf ${4:+-udf-version "$4"} -udf-volume-name "$1" -o "$2" "$3"
  else
    genisoimage -quiet -udf -allow-limited-size -input-charset utf-8 -V "$1" -o "$2" "$3"
  fi
}
