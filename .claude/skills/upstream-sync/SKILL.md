---
name: upstream-sync
description: Bring Viren070/AIOStreams upstream main into this fork's tizen-5.5 branch (kondors1995/AIOStreams) and keep the Samsung 2020 TV (Tizen 5.5, Chromium 69) build working. Merges, resolves the known conflicts, scans the new upstream code for what Chromium 69 lacks, reruns the checks, always profiles on the TV against the baseline in notes/profiling.md, tests on the TV, pushes and optionally releases. Use when asked to sync, merge, rebase or update from upstream, take in upstream changes, or update the fork.
---

# Sync the fork with upstream

The fork's branch is `tizen-5.5` (remote `sov`). Upstream is `origin` (Viren070/AIOStreams) and moves fast
(about 150 commits in two weeks), so a sync is a merge of a lot, with conflicts in the same few places.
Background, commands and scripts for the TV are in `notes/` (a separate git repo, ignored here):
`notes/fork-workflow.md`, `notes/aiostreams-tv.md`, `notes/pr-1546.md`, and `notes/tools/tv/`. Read them first.

## Rules

- **Merge, never rebase.** The branch is published; no force pushes. `git config rerere.enabled true` is on.
- **Never push to `origin`.** Never push `main` either: it carries upstream's workflows, which would run on the fork.
- Push `tizen-5.5` and tag a release only when the user asked, or after saying what you are about to push.
- Don't drive the TV (install, debug launch, key presses) while the user may be watching: say so and ask. Do ask: step 5
  (profiling) is not optional, so a sync is not finished until the user has let it run.
- **Always profile after a sync** (step 5), however small the merge: upstream's changes have cost this app seconds of
  main-thread time before without any test failing (forced layouts in Discover, a polyfill polling every frame).
- Commit trailer: the one the session's attribution reminder gives.

## 1. Look before merging

```sh
git status --short                                  # must be clean, on tizen-5.5
git fetch origin main
OLD=$(git merge-base tizen-5.5 origin/main)         # keep this: the scan below needs it
git log --oneline tizen-5.5..origin/main | wc -l    # 0 = nothing to do, stop
git diff --stat $OLD origin/main -- packages/web packages/ui packages/smart-tv packages/core/src/jellyfin .github | tail -20
```

Tell the user how far behind it is and which areas changed (web app, ui, smart-tv, core jellyfin, workflows).

## 2. Merge

```sh
git checkout main && git merge --ff-only origin/main && git checkout tizen-5.5   # main stays local
git merge main
```

Resolve each conflict by keeping upstream's change and our TV addition. Known ones:

| File | Resolution |
| --- | --- |
| `.github/workflows/*` (modify/delete, or new) | `git ls-files .github/workflows \| grep -v tizen-release.yml \| xargs -r git rm -qf` |
| `pnpm-lock.yaml` | take main's (`git checkout --theirs`), then `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile` |
| `packages/web/package.json` | keep both sides: ours are `core-js`, `shaka-player`, the `test` script |
| `packages/web/src/locales/*` | don't edit by hand: take main's, run `pnpm -F @aiostreams/web i18n:extract`; keep en-GB.po, messages.pot, ar-XB.po, en-XA.po; `git checkout main -- de.po pl.po` (Weblate's) |
| `packages/web/rsbuild.config.ts` | keep upstream's `tools` (Lingui); the standalone block spreads `...tools`, adds `swc.env.exclude` for `es.json.parse` and the `legacyCss()` postcss step |
| `packages/web/src/lib/input/focus.ts` | upstream's change plus our `focusVisible()` (`matches(':focus-visible')` throws on Chromium 69) and the `data-pointer-focus` check |
| `packages/web/src/styles.css` | upstream's change plus our `.no-focus-visible` ring rules (box-shadow, pointer focus and `#root`/`body` excluded) |
| `packages/web/src/lib/format.ts` | formatters made per locale (`perLocale`); the `RelativeTimeFormat` fallback in `untilLabel` |
| `packages/ui/src/combobox`, `modal` | keep our `:focus-visible` fallback and the no-`:has()`-from-script change |
| `packages/web/src/components/open-card.tsx`, `grid-open-card.tsx`, `media-row.tsx`, `mixed-grid.tsx`, `pages/home.tsx`, `discover.tsx`, `settings/interface.tsx`, `lib/settings.ts` | the open cards (Thomas's `bc94d188`, reworked): own switches `openCards` and `discoverTrailers` (not a Hero mode), cards as tall as the poster, `layered()` keeps the frame's own layer (without it a trailer plays sound and no picture), `whenOnScreen()` for per-card layout reads, `lib/playback/bars.ts` crops a trailer's black bars. Keep upstream's props (`itemType`, `favourite`, `data-nav-resume`) beside them |
| `packages/web/src/pages/player.tsx`, `lib/playback/*` | failover (`useFailover`, `versions` prop), `unsupportedOnTv` ordering, trailers (`dash.ts`, `resolveYouTube(id, {dash})`) |
| `packages/web/src/components/version-picker.tsx` | the "This TV can't play …" badge (`unsupported`) |
| `packages/smart-tv/boot.js`, `README.md`, `scripts/build.mjs` | keep ours: classes, `Intl.*` stand-ins, release notes |
| `packages/core/src/jellyfin/media.ts` | our `codecTag()` (Atmos names no codec) and its test |

Anything else: keep both intents and say so in the merge commit. When upstream moves a file we changed, look for its
new home with `git log --follow` rather than dropping our change.

## 3. Checks (all must pass)

```sh
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"
pnpm install --frozen-lockfile
pnpm -F @aiostreams/core build
pnpm -F @aiostreams/web typecheck && pnpm -F @aiostreams/web lint && pnpm -F @aiostreams/web test
pnpm -F @aiostreams/web i18n:extract && git checkout main -- packages/web/src/locales/de.po packages/web/src/locales/pl.po
```

The lint rule `lingui/no-unlocalized-strings` fails on any user-visible string not in `t\`\``/`<Trans>`; codec names in
`lib/playback/support.ts` are exempt by a file-level disable. Core's `toWireMediaInfo > maps audio and subtitle
tracks` test fails on upstream too.

## 4. What upstream added that Chromium 69 can't run

```sh
.claude/skills/upstream-sync/scripts/scan-upstream.sh $OLD origin/main   # JS and CSS added lines using unsupported things
pnpm -F @aiostreams/web build:standalone
.claude/skills/upstream-sync/scripts/audit-css.py                        # CSS features still in the build, vs the baseline in the script
```

Also look for new code that reads layout (`getBoundingClientRect`, `offsetWidth`, `scrollTop`, `getComputedStyle`) from a ref
callback, a layout effect, or per item in a list: on this TV each read after a DOM write is a full layout (Discover's
posters cost 1.1 s that way until `whenOnScreen()` batched them). Batch such reads, or move them out of the mount path.

Then probe the real engine (`notes/tools/tv/probe-css.html`, steps in `notes/aiostreams-tv.md`): add one line per new
class and read the computed style in the local Chromium 69. A script can't tell "present" from "broken"; the probe can.

Already handled: `:is()`, `:focus-visible`, flex `gap`, `aspect-ratio`, `dvh`, `start-*`/`end-*` and logical corner
radii (LTR plus `[dir=rtl]`), `min()`/`max()`; `Intl.ListFormat`, `DisplayNames`, `Segmenter`, `RelativeTimeFormat`;
`getAnimations`. Not handled, by choice: `:where()` (Tailwind forms resets), `:has()`, `color-scheme`.

For a new gap: JS feature → a stand-in in `packages/smart-tv/boot.js` (plain ES5 syntax) or a guard at the call;
CSS feature → a fallback in `packages/web/legacy-css.ts` with a case in `legacy-css.test.ts`, and a class
`boot.js` sets from `CSS.supports` if it must be conditional.

## 5. Profile on the TV (always)

After the merge commit builds, install it and run the profile in `notes/profiling.md` (read it: the scripts, the
baseline table, the rules, and what counts as a regression):

1. `ui-sweep.mjs` with open cards and Discover trailers ON (leave them ON afterwards), against the baseline table.
2. A **cold** `profile-card.mjs 3 9` straight after a fresh launch, then a warm one (`6 8`): trailer playing by ~6 s cold,
   ~3.5 s warm; no new frames over 100 ms.
3. If a page or the trailer start regressed, or `getBoundingClientRect` or another single function leads the JS
   profile: `cpu-nav.mjs /discover/<view id>` (first visit, then a revisit) and `cpu-card.mjs`; read the call chain and fix
   the cause (or report it if it is upstream's and not worth carrying a patch).
4. No exceptions or console errors anywhere in the sweep (the Activity page once threw on `Intl.RelativeTimeFormat`).

Report the table against the baseline in the final message. Replace the baseline in `notes/profiling.md` once the user
accepts the sync.

## 6. Commit, TV, push

- Commit the merge with a message that lists what was resolved and any new stand-ins.
- Smoke-test on the TV too (pages, Play, Trailers, Skip): commands and scripts in
  `notes/aiostreams-tv.md` and `notes/tools/tv/` (`goto.mjs`, `click-play.mjs`, `trailer-test.mjs`).
- Push: `git push sov tizen-5.5`. CI (`tizen-release.yml`) builds the package: `gh run list -R kondors1995/AIOStreams`.
- Release only if asked: write `packages/smart-tv/release-notes/<tag>.md`, commit, `git tag -a tizen-v0.6.0-N -m "…"`
  (next free N: `gh release list -R kondors1995/AIOStreams`), `git push sov <tag>`, check with `gh release view`.
  Install the published asset by re-signing it (flow in `notes/pr-1546.md`).

## 7. Leave notes

Update `notes/fork-workflow.md` (upstream commit merged), `notes/profiling.md` (new baseline, once accepted) and
`notes/pr-1546.md` with new conflicts, stand-ins, profile findings and anything that behaved differently. Report to the user: how many upstream commits came in, what conflicted and how it
was resolved, what the scan found, the profile against the baseline, what passed on the TV, and what is not pushed.
