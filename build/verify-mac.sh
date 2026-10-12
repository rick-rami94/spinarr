#!/bin/sh
# Asserts a macOS release build is signed, notarized, stapled and carries the right
# entitlements: sh build/verify-mac.sh <dist dir>
# Run only on tag builds with signing credentials. On an unsigned build it fails,
# naming the first thing that is missing. No hard-coded binary list: every file under
# Contents/Resources/engine/ is checked, whatever the engine ships.
set -eu

fail() { echo "verify-mac: $*" >&2; exit 1; }
[ $# -eq 1 ] || fail "usage: sh build/verify-mac.sh <dist dir>"
DIST=$1
[ -d "$DIST" ] || fail "no dist directory at $DIST"

set -- "$DIST"/mac*/Spinarr.app
[ $# -eq 1 ] && [ -d "$1" ] || fail "expected one Spinarr.app under $DIST/mac*"
APP=$1
set -- "$DIST"/*.dmg
[ $# -eq 1 ] && [ -f "$1" ] || fail "expected one .dmg in $DIST"
DMG=$1

has() { printf '%s\n' "$1" | grep -q -- "$2"; }
details() { codesign -dvv "$1" 2>&1 || fail "$1 is not code-signed"; }
ents() { codesign -d --entitlements - --xml "$1" 2>/dev/null || true; }
signed_with_runtime() { # <file> <label>
  d=$(details "$1")
  has "$d" 'Authority=Developer ID Application: Rick Ramirez' || fail "$2 is not signed by Developer ID Application: Rick Ramirez"
  has "$d" 'flags=.*runtime' || fail "$2 is not signed with the hardened runtime"
  has "$d" '^Timestamp=' || fail "$2 has no secure timestamp"
}

# The whole bundle, sealed and nested code included.
codesign --verify --deep --strict --verbose=2 "$APP" || fail "$APP fails codesign --verify --deep --strict"
signed_with_runtime "$APP" "$APP"

# SF-6: the app itself never disables library validation.
has "$(ents "$APP")" 'allow-jit' || fail "$APP is missing com.apple.security.cs.allow-jit"
! has "$(ents "$APP")" 'disable-library-validation' || fail "$APP carries disable-library-validation (only the engine may)"

# ...nor do the Electron helpers.
for h in "$APP"/Contents/Frameworks/*.app; do
  [ -e "$h" ] || fail "no Electron helper apps under $APP/Contents/Frameworks"
  ! has "$(ents "$h")" 'disable-library-validation' || fail "$h carries disable-library-validation (only the engine may)"
done

# Every engine binary: engine entitlement only, hardened runtime, timestamp.
n=0
for b in "$APP"/Contents/Resources/engine/*; do
  [ -f "$b" ] || fail "no engine binaries under $APP/Contents/Resources/engine"
  signed_with_runtime "$b" "$b"
  e=$(ents "$b")
  has "$e" 'disable-library-validation' || fail "$b is missing com.apple.security.cs.disable-library-validation"
  ! has "$e" 'allow-jit' || fail "$b carries allow-jit (the engine must not)"
  n=$((n + 1))
done

# Notarization tickets, stapled for offline first launch.
xcrun stapler validate "$APP" || fail "$APP has no stapled notarization ticket"
xcrun stapler validate "$DMG" || fail "$DMG has no stapled notarization ticket"
codesign -dvv "$DMG" 2>&1 | grep -q 'Authority=Developer ID Application: Rick Ramirez' || fail "$DMG is not signed by Developer ID Application: Rick Ramirez"

# Gatekeeper. D-04 names "spctl -a -vvv -t install", but Apple DTS documents -t install
# for installer packages only; the dmg uses -t open with the primary-signature context and the
# app uses -t exec (RESEARCH Pitfall 2).
out=$(spctl -a -t exec -vvv "$APP" 2>&1) || fail "Gatekeeper rejects $APP: $out"
has "$out" 'source=Notarized Developer ID' || fail "Gatekeeper does not see $APP as Notarized Developer ID: $out"
out=$(spctl -a -t open -vvv --context context:primary-signature "$DMG" 2>&1) || fail "Gatekeeper rejects $DMG: $out"
has "$out" 'source=Notarized Developer ID' || fail "Gatekeeper does not see $DMG as Notarized Developer ID: $out"

echo "verify-mac: OK ($n engine binaries)"
