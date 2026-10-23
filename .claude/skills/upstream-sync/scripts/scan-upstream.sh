#!/usr/bin/env bash
# Lists the lines upstream added between two commits that use something Chromium 69 (2020 Samsung TVs) lacks.
# Usage: scan-upstream.sh <old upstream commit> [new, default origin/main]
set -euo pipefail
old=${1:?usage: scan-upstream.sh <old upstream commit> [new]}
new=${2:-origin/main}
git diff "$old" "$new" -U0 -- packages/web/src packages/ui/src packages/web/index.html |
  awk '/^\+\+\+ /{file=substr($2,3); next} /^\+/{print file ": " substr($0,2)}' |
  grep -E "Intl\.(ListFormat|DisplayNames|Locale|Segmenter|DurationFormat)|dateStyle|timeStyle|randomUUID|replaceChildren|AbortSignal\.(timeout|any)|structuredClone|Array\.fromAsync|Object\.groupBy|Map\.groupBy|Promise\.withResolvers|\.at\(-?[0-9]|\.findLast|\.toSorted|\.toReversed|:has\(|:where\(|matches\(':focus-visible|getAnimations|requestVideoFrameCallback|checkVisibility|showPopover|\.inert\b|userAgentData|backdrop-filter|[0-9](dvh|svh|lvh)|text-wrap|scrollbar-width|color-mix|oklch|@container|@layer|@starting-style|anchor-name|\bpopover\b|view-transition|\.scrollend|ElementInternals|CompressionStream|URLPattern" \
  || echo "nothing flagged"
