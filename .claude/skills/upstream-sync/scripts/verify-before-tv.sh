#!/usr/bin/env bash
# Everything that can be checked without the TV, in order, stopping at the first failure. Run after a merge, before
# installing on the TV. Builds only the Tizen package (web's standalone build, then the .wgt): never `pnpm build`.
#   verify-before-tv.sh            full run
#   TIZEN_PROFILE=name verify-before-tv.sh   sign with that Tizen Studio profile (default aiostreams-tv); TIZEN_PROFILE= builds unsigned (CI)
#   CHROMIUM69=/path/to/chrome verify-before-tv.sh   Chromium 69 binary for the boot check (default ~/tizen-dl/chromium69)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"
step=0
run() { step=$((step + 1)); printf '\n\033[1m[%d] %s\033[0m\n' "$step" "$1"; shift; "$@"; }
trap 'printf "\n\033[31mFAILED at step %d\033[0m\n" "$step"' ERR
scripts=.claude/skills/upstream-sync/scripts

run "install (frozen lockfile; the web app and the Tizen package only)" pnpm install --frozen-lockfile --filter "@aiostreams/web..." --filter @aiostreams/smart-tv
run "core build (web's types come from it)" pnpm -F @aiostreams/core build
run "web typecheck" pnpm -F @aiostreams/web typecheck
run "web lint (includes lingui/no-unlocalized-strings)" pnpm -F @aiostreams/web lint
run "web tests: CSS fallbacks, black-bar detection, Chromium 69 static ratchets" pnpm -F @aiostreams/web test
run "translation catalogs" bash -c '
  pnpm -F @aiostreams/web i18n:extract >/dev/null
  git checkout -- packages/web/src/locales/de.po packages/web/src/locales/it.po packages/web/src/locales/pl.po 2>/dev/null || true
  git status --short packages/web/src/locales | sed "s/^/  changed (commit it): /"
  echo "  catalogs regenerated; Weblate-owned languages left as committed"'
run "build the Tizen package only (web standalone, then the .wgt)" bash -c '
  pnpm -F @aiostreams/web build:standalone
  TIZEN_PROFILE="${TIZEN_PROFILE-aiostreams-tv}" node packages/smart-tv/scripts/build.mjs tizen'
run "boot the package in Chromium 69: scripts parse, app starts, boot classes set" node "$scripts/check-tizen-package.mjs"
run "CSS features left in the build vs the baseline" python3 "$scripts/audit-css.py"

printf '\n\033[32mAll pre-TV checks passed.\033[0m Next: install on the TV and run the profile in notes/profiling.md.\n'
