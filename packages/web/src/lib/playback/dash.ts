import { t } from '@lingui/core/macro';

/**
 * A DASH manifest handed round as a `data:` address, and played in the page's
 * `<video>` through Shaka Player. A YouTube trailer on a Samsung TV goes so:
 * AVPlay plays only an HLS playlist's first size, YouTube's smallest, where
 * the web engine's MSE plays YouTube's own 1080p, as YouTube's TV app does.
 */

const PREFIX = 'data:application/dash+xml;base64,';

export const isDash = (url: string) => url.startsWith(PREFIX);

export const dashAddress = (manifest: string) => PREFIX + btoa(manifest);

/**
 * The manifest at `url` without its sizes taller than `max`, as for a card
 * that draws a trailer small; as it was where none would be left.
 */
export function capHeight(url: string, max: number): string {
  if (!isDash(url)) return url;
  const manifest = atob(url.slice(PREFIX.length));
  const capped = manifest.replace(
    /<Representation\b[^>]*\bheight="(\d+)"[^>]*>[\s\S]*?<\/Representation>/g,
    (representation, height: string) =>
      Number(height) > max ? '' : representation
  );
  return /contentType="video"[^>]*><Representation/.test(capped)
    ? dashAddress(capped)
    : url;
}

/** One stream of a manifest: a whole file, indexed by its own `sidx`. */
export interface DashStream {
  id: string;
  url: string;
  mime: string;
  codecs: string;
  bandwidth: number;
  width?: number;
  height?: number;
  init: { start: number; end: number };
  index: { start: number; end: number };
}

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* eslint-disable lingui/no-unlocalized-strings -- a DASH manifest's XML */
function representation(s: DashStream): string {
  const size =
    s.width && s.height ? ` width="${s.width}" height="${s.height}"` : '';
  return (
    `<Representation id="${escape(s.id)}" codecs="${escape(s.codecs)}" bandwidth="${s.bandwidth}"${size}>` +
    `<BaseURL>${escape(s.url)}</BaseURL>` +
    `<SegmentBase indexRange="${s.index.start}-${s.index.end}">` +
    `<Initialization range="${s.init.start}-${s.init.end}"/>` +
    `</SegmentBase></Representation>`
  );
}

/** An on-demand manifest of one video and one audio set. */
export function dashManifest(
  durationMs: number,
  video: DashStream[],
  audio: DashStream[]
): string {
  const set = (type: 'video' | 'audio', streams: DashStream[]) =>
    streams.length
      ? `<AdaptationSet contentType="${type}" mimeType="${type}/mp4" segmentAlignment="true">` +
        streams.map(representation).join('') +
        `</AdaptationSet>`
      : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT2S" mediaPresentationDuration="PT${(durationMs / 1000).toFixed(3)}S">` +
    `<Period>${set('video', video)}${set('audio', audio)}</Period></MPD>`
  );
}
/* eslint-enable lingui/no-unlocalized-strings */

/** Loads Shaka ahead, so a first trailer doesn't wait on loading and parsing it. */
export const preloadShaka = () => void import('shaka-player').catch(() => {});

/**
 * Answers Shaka's questions about the TV's panel ourselves: no 4K or 8K, no
 * HDR, as the trailers playing through here (YouTube's, up to 1080p; titles
 * play through the TV's own player) need no more. Its Tizen checks otherwise
 * load Samsung's product-info and AV-info plugins, most of a second as a
 * first trailer starts.
 */
function answerForTv(): void {
  const webapis = (
    window as { webapis?: Record<string, Record<string, unknown> | undefined> }
  ).webapis;
  const asked: Record<string, string[]> = {
    productinfo: ['is8KPanelSupported', 'isUdPanelSupported'],
    avinfo: ['isHdrTvSupport'],
  };
  for (const [namespace, questions] of Object.entries(asked))
    for (const question of questions)
      try {
        const api = webapis?.[namespace];
        if (api?.[question]) api[question] = () => false;
      } catch {
        // Left as it was: Shaka asks the TV.
      }
}

/**
 * Plays the manifest at `url` in `video`, Shaka fetched only then. It starts
 * on the largest size the connection is assumed to carry, as a trailer ends
 * before a cautious start climbs. Returns its teardown. `startSeconds` is how
 * much it buffers before it plays, and again after a stall; `bufferSeconds`
 * how far ahead it keeps buffered (a long fill is a long burst of fetching and
 * appending on the page's thread).
 */
export function playDash(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
  {
    startSeconds = 2,
    bufferSeconds = 30,
  }: { startSeconds?: number; bufferSeconds?: number } = {}
): () => void {
  // After the teardown, nothing of this player is heard: the video may be
  // another file's by then.
  let gone = false;
  let player:
    | InstanceType<(typeof import('shaka-player'))['default']['Player']>
    | undefined;
  const fail = (message: string) => {
    if (!gone) onError(message);
  };
  const codeOf = (error: unknown) =>
    (error as { code?: number }).code ?? String(error);
  void (async () => {
    let shaka: (typeof import('shaka-player'))['default'];
    try {
      shaka = (await import('shaka-player')).default;
      if (gone) return;
      const native = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
      answerForTv();
      shaka.polyfill.installAll();
      // Shaka's stand-in for it asks the video how many frames it drew on every
      // frame, which costs a Samsung TV (Chromium 69) most of a second as a
      // trailer starts; Shaka carries on without it.
      if (!native) {
        Reflect.deleteProperty(
          HTMLVideoElement.prototype,
          'requestVideoFrameCallback'
        );
        Reflect.deleteProperty(
          HTMLVideoElement.prototype,
          'cancelVideoFrameCallback'
        );
      }
      player = new shaka.Player();
      await player.attach(video);
    } catch (error) {
      // Made but not attached, it still holds what its constructor set up.
      void player?.destroy();
      const code = codeOf(error);
      fail(t`The trailer didn't load (error ${code})`);
      return;
    }
    if (gone) return;
    player.configure({
      abr: { defaultBandwidthEstimate: 20_000_000 },
      streaming: {
        bufferingGoal: bufferSeconds,
        rebufferingGoal: startSeconds,
      },
    });
    // Only what stops it: Shaka retries the rest itself.
    player.addEventListener('error', (event) => {
      const detail = (
        event as unknown as { detail?: { code?: number; severity?: number } }
      ).detail;
      if (detail?.severity !== shaka.util.Error.Severity.CRITICAL) return;
      const code = detail.code ?? '?';
      fail(t`The trailer stopped (error ${code})`);
    });
    try {
      await player.load(url);
    } catch (error) {
      const code = codeOf(error);
      fail(t`The trailer didn't load (error ${code})`);
    }
  })();
  // Ready at once, as a load can be left while it is still going.
  return () => {
    gone = true;
    void player?.destroy();
  };
}
