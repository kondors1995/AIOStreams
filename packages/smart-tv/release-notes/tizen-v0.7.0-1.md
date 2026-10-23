The AIOStreams TV app for **Samsung TVs from 2020 (Tizen 5.5, Chromium 69) and newer**: upstream's app plus what a 2020 TV needed. Built on upstream `main` at `ed8b085f`, which includes upstream's smart-tv 0.7.0. Tested on one TV, a UE43TU8002KXXH (2020, Tizen 5.5).

## Install

`aiostreams-tizen-0.7.0-1.wgt` is **unsigned**: a Samsung TV in developer mode installs only an app signed with a Samsung certificate that lists that TV.

- **Apps2Samsung:** pick *Custom WGT File* and choose the `.wgt`. It signs the app for your TV.
- **Tizen Studio:** create a Samsung certificate with the TV's DUID, then `tizen package -t wgt -s <profile>` and `tizen install` (see `packages/smart-tv/README.md`).

## What this adds to upstream

### Runs on 2020 Samsung TVs
- A build for Chromium 69, with the missing built-ins polyfilled and the syntax lowered.
- Stand-ins for CSS the engine lacks, applied only on a TV that needs them (classes `boot.js` sets), so newer TVs and the other apps are untouched: `:is()`, `:focus-visible`, flex `gap`, `aspect-ratio`, `dvh`, `min()`/`max()`, and `start-*`/`end-*` positions and logical corner radii (right-to-left pages keep working).
- Stand-ins for missing browser features: `Intl.ListFormat`, `DisplayNames` and `Segmenter`, relative dates ("tomorrow", "in 3 days", in English there), and focus checks that threw on every key in the player.
- "This TV is too old" now means before 2020 on Samsung, and a TV with no console shows what stopped the app from starting.
- Pages stay opaque outside the player, and the left rail is reachable from narrow pages.
- Artwork is asked for at the screen's density and width, never wider than the screen, and date formatters are made once (about 10 ms each on this TV).

### Open cards (new, optional)
- **Settings → Interface → Open cards** (TV only, off by default): the poster focus rests on opens out, as tall as the poster, to its landscape picture with its type, genres, year, length, rating and overview under it. On Home's rows and in Discover's grid.
- Its **trailer plays with sound** 2 s after focus lands, held to 720p, and any black bars the trailer carries in its own frames are cropped so it fills the card. **Trailers on Discover** turns the trailer off in Discover's grid.
- Based on thomasrtg's work in upstream PR #1582 (authorship kept), reworked: its own switches instead of a Hero mode, Home keeps its hero and rows, no white focus mode.
- The first trailer after launch starts in about 5 s, later ones in about 3.5 s, on the 2020 TV.

### Playback
- **Versions the TV can't decode** (Dolby Vision, codecs it lacks) are listed last, with a "This TV can't play …" badge, and are not picked first.
- **Try the next version if one fails** (Settings → Playback, on by default, saved to your account): a version that fails to start hands over to the next one the TV decodes, from the same point, once per player, also after Retry. Versions that failed are remembered for ten minutes.
- The stopped-playback report is sent the way Chromium 69 accepts it.
- *Server side:* a release's audio codec comes from the first tag that names one, so "Atmos" is no longer reported as TrueHD. This reaches the TV only once your server runs this code.

### Trailers
- YouTube trailers play on the TV, in 1080p: the app asks YouTube for the streams itself and plays them in the page's own video through Shaka Player (loaded only when a trailer plays). A library item's own YouTube version still goes to the TV's player. Based on thomasrtg's work in upstream PR #1582, with his authorship kept.

### Faster, and one crash fixed
- Opening Discover no longer lays the page out again for every poster (about a second less script on a first visit, half on a revisit).
- Shaka starts a trailer without a per-frame poll and without loading Samsung's product-info plugins, so the first trailer starts about a second sooner.
- The Activity page threw on a 2020 TV as soon as an entry was more than a minute old (`Intl.RelativeTimeFormat`); it now shows "# minutes ago" and the like.
- Tests that run before a build reaches a TV: the Chromium 69 checks over the source, the black-bar detection, the CSS fallbacks, and a boot of the package in Chromium 69.

### Also
- The TV apps' documentation covers 2020 Samsung TVs.
- One workflow builds this package, and releases it on a `tizen-v*` tag. The webOS package, Docker, desktop and Android workflows are not part of this fork.

## Known gaps
- Discover is rough for the first seconds while its posters load and decode (frame times about 180 ms at the 95th percentile, 37 ms once settled), and its selection can paint one scroll step high after a glide on the 2020 TV.
- A trailer's first start after launch freezes the screen for about a second on the 2020 TV.
- Live updates from the server over a WebSocket don't connect from the TV yet.
- Rules that need `:where()` (Tailwind's form resets) or `:has()` (a few calendar corners) are missing on Chromium 69.
- Not tried: Tizen 6 or newer, a title with a single trailer, and the lower-quality trailer fallbacks.
- Trailers depend on YouTube's player API, as the desktop and Android apps do, and can break when it changes.
