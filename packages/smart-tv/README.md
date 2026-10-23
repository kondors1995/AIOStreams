# AIOStreams TV apps

The AIOStreams app (`packages/web`) packaged for LG (webOS) and Samsung (Tizen) TVs. Each
package holds the web app's standalone build, which picks its own server, plus the platform's
manifest and icons, and `boot.js`, which runs first. The TV loads the files from the package. LG
TVs play through the page's `<video>` element, Samsung TVs through Samsung's own player (AVPlay),
drawn beneath the page. The web app finds out which TV it's on from what the TV injects
(`window.webOSSystem` or `window.tizen`); see `src/lib/hosts/webos.ts` and `tizen/` there.

Expect LG TVs from 2023 (webOS 23) and Samsung TVs from 2020 (Tizen 5.5, Chromium 69) or newer.
The standalone build targets Chromium 69: its scripts are compiled down and polyfilled, and
`legacy-css.ts` in `packages/web` gives the CSS that engine drops a stand-in, which applies under
the `no-focus-visible`, `no-aspect-ratio` and `no-flex-gap` classes `boot.js` sets on engines that
need them. Older TVs still install the packages: `boot.js` says the TV is too old and offers to
try. It also shows what stopped the app starting, as a TV has no console.

## Build

```sh
pnpm -F @aiostreams/smart-tv build:webos   # out/io.github.viren070.aiostreams_<version>_all.ipk
pnpm -F @aiostreams/smart-tv build:tizen   # out/AIOStreams.wgt
```

Both build the web app first. The version comes from `package.json` and is written into the
manifest (`webos/appinfo.json`, `tizen/config.xml`), which carries none itself.

The `.wgt` is unsigned. A Samsung TV only installs a package signed for that TV, so whatever
installs it signs it first (below). With `TIZEN_PROFILE` set to a Tizen Studio security profile,
the build signs it with that profile instead, through Tizen Studio's `tizen` command.

### Trailers on Samsung TVs

The Tizen package resolves YouTube trailers itself (`web/src/lib/hosts/tizen/youtube.ts`, with the
desktop and Android apps' clients). AVPlay plays only an HLS playlist's first size, YouTube's
smallest, so the separate H.264 sizes up to 1080p and the AAC audio go as a DASH manifest in a
`data:` address, which the page's own video plays through Shaka Player (`web/src/lib/playback/dash.ts`),
loaded only then. With Settings > Interface > "Open cards" on, an opened card plays its first
trailer, with sound, 1.3 s after it opens (2 s after focus lands), held to 720p; "Trailers on Discover"
turns that off in Discover's grid.

## Releases

This fork releases only the Tizen package. The Tizen Release workflow builds it on every push to
`tizen-5.5` and leaves `aiostreams-tizen-<commit>.wgt` on the run as an artifact. Pushing a `tizen-v*`
tag also attaches `aiostreams-tizen-<tag without tizen-v>.wgt` to a release of that tag:

```sh
git tag tizen-v0.6.0-1 && git push sov tizen-v0.6.0-1
```

The package is unsigned (see Tizen below). The webOS package, and the upstream release-please,
Docker, desktop, Android and docs workflows, are not part of this fork's releases.

## Install

### webOS

1. Install **Developer Mode** from the LG Content Store, sign in with an LG account and turn it on.
   It shows the TV's IP address and a passphrase. The session runs out after a while; extend it in
   the same app.
2. Install the `.ipk` with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop), or
   with the CLI this package already depends on:

```sh
cd packages/smart-tv
pnpm exec ares-setup-device   # add the TV: IP, port 9922, the passphrase
pnpm exec ares-install --device <name> out/io.github.viren070.aiostreams_<version>_all.ipk
```

With the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) on the TV, add
`https://raw.githubusercontent.com/Viren070/AIOStreams/smart-tv-feed/apps.json` as a repository in its
settings instead: the app then installs and updates from the channel.

### Tizen

A Samsung TV in developer mode installs a `.wgt` only when it is signed with a Samsung certificate
that lists that TV's device ID (DUID), so releases ship it unsigned.

- **Apps2Samsung** does all of it: pick **Custom WGT File** in its release list and choose the
  `.wgt`. It signs the app with a certificate made from your Samsung account for that TV.
- **Tizen Studio**: in Certificate Manager, create a Samsung certificate with the TV's DUID, and use
  that profile as `TIZEN_PROFILE`. Then turn on developer mode on the TV (Apps, type `12345`, enter
  the computer's IP) and run:

```sh
sdb connect <tv-ip>
tizen install -n out/AIOStreams.wgt -t <device-name>   # name from `sdb devices`
```
