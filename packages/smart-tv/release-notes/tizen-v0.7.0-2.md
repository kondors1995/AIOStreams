Same as tizen-v0.7.0-1 plus one fix. Tested on a UE43TU8002KXXH (2020, Tizen 5.5).

## Install

`aiostreams-tizen-0.7.0-2.wgt` is **unsigned**: a Samsung TV in developer mode installs only an app signed with a Samsung certificate that lists that TV. Use Apps2Samsung (*Custom WGT File*) or Tizen Studio, as in [tizen-v0.7.0-1](https://github.com/kondors1995/AIOStreams/releases/tag/tizen-v0.7.0-1).

## Fixed

- **Playback stuck on the loading cover.** When a show remembered an audio track, the app picked it as soon as the stream loaded. AVPlay refuses that in its prepared state, the error escaped before `play()`, and the TV never started. The pick is now retried once playing.
