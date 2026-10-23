import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/*
 * Static checks for what a 2020 Samsung TV (Chromium 69) can't run or can't
 * afford, over the web app's source. Each is a ratchet: the counts in
 * chromium69-baseline.json are what was reviewed, a count that grows (a sync
 * brought in new code, or ours did) fails the test, and the fix is to guard,
 * batch or stand in for it, then record the new count:
 *
 *   UPDATE_BASELINE=1 node --test chromium69.test.ts
 *
 * They don't prove the code is fine, they make a human look at each new case.
 */

const SRC = path.join(import.meta.dirname, 'src');
const BASELINE_FILE = path.join(
  import.meta.dirname,
  'chromium69-baseline.json'
);

function sources(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'locales' ? [] : sources(file);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [file]
      : [];
  });
}

const rel = (file: string) => path.relative(SRC, file);

/** APIs Chromium 69 lacks that neither core-js nor boot.js stands in for. */
const MISSING = {
  'Intl.Locale / DurationFormat': /Intl\.(Locale|DurationFormat)\b/,
  'dateStyle / timeStyle': /\b(dateStyle|timeStyle)\b/,
  'crypto.randomUUID': /randomUUID/,
  replaceChildren: /replaceChildren/,
  'AbortSignal.timeout / any': /AbortSignal\.(timeout|any)/,
  'Array.fromAsync / Object.groupBy': /Array\.fromAsync|(Object|Map)\.groupBy/,
  'Promise.withResolvers': /Promise\.withResolvers/,
  '.findLast / .toSorted / .toReversed': /\.(findLast|toSorted|toReversed)\(/,
  'getAnimations (Chrome 84)': /getAnimations\(/,
  'requestVideoFrameCallback (Chrome 83)': /requestVideoFrameCallback/,
  checkVisibility: /checkVisibility/,
  'popover / showPopover': /showPopover|\bpopover\b/,
  userAgentData: /userAgentData/,
  'URLPattern / CompressionStream': /URLPattern|CompressionStream/,
  'scrollend event': /scrollend/,
  ':has() in a selector string (throws)':
    /(querySelector(All)?|matches|closest)\(\s*['"`][^'"`]*:has\(/,
  ':focus-visible in matches() (throws)':
    /matches\(\s*['"`][^'"`]*:focus-visible/,
  ElementInternals: /ElementInternals/,
} as const;

/**
 * Layout reads: after a DOM write each one makes the browser lay the page out
 * again. `onScreen()` (lib/use-in-view.ts) is one: it asks for a rect.
 */
const LAYOUT_READ =
  /getBoundingClientRect\(|\bonScreen\(|\.(offsetWidth|offsetHeight|offsetLeft|offsetTop|clientWidth|clientHeight|scrollWidth|scrollHeight)\b|getComputedStyle\(/g;

/** The code that runs while React mounts: layout effects and ref callbacks. */
const MOUNT_PATH =
  /useLayoutEffect\(|\bref=\{\(|\bref:\s*\(|\(el(?:: [^)]*)?\)\s*=>\s*\{?\s*\n?\s*if \(!?el/g;
const WINDOW = 700;

type Counts = Record<string, Record<string, number>>;

function measure(): { missing: Counts; mountReads: Counts } {
  const missing: Counts = {};
  const mountReads: Counts = {};
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, pattern] of Object.entries(MISSING)) {
      const n = text.split('\n').filter((line) => pattern.test(line)).length;
      if (n) (missing[name] ??= {})[rel(file)] = n;
    }
    let reads = 0;
    for (const m of text.matchAll(MOUNT_PATH))
      reads += (text.slice(m.index, m.index + WINDOW).match(LAYOUT_READ) ?? [])
        .length;
    if (reads)
      (mountReads['layout reads in layout effects and ref callbacks'] ??= {})[
        rel(file)
      ] = reads;
  }
  return { missing, mountReads };
}

const current = measure();

if (process.env.UPDATE_BASELINE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n');
  console.log('chromium69-baseline.json written');
}

const baseline: typeof current = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  : { missing: {}, mountReads: {} };

function grown(now: Counts, was: Counts): string[] {
  return Object.entries(now).flatMap(([name, files]) =>
    Object.entries(files)
      .filter(([file, n]) => n > (was[name]?.[file] ?? 0))
      .map(
        ([file, n]) =>
          `${name}: ${file} has ${n}, was ${was[name]?.[file] ?? 0}`
      )
  );
}

test('no new use of an API Chromium 69 lacks', () => {
  const found = grown(current.missing, baseline.missing);
  assert.deepEqual(
    found,
    [],
    'Guard it, add a stand-in in packages/smart-tv/boot.js, or avoid it; then record it with UPDATE_BASELINE=1.'
  );
});

test('no new layout reads while React mounts', () => {
  const found = grown(current.mountReads, baseline.mountReads);
  assert.deepEqual(
    found,
    [],
    'Reads in layout effects and ref callbacks lay the page out once per card on a TV (Discover cost 1.1 s). Batch them with whenOnScreen() in lib/use-in-view.ts, or read once outside the mount; then record with UPDATE_BASELINE=1.'
  );
});

test('every Intl.RelativeTimeFormat use is behind its fallback', () => {
  // Chromium 69 has none, and no stand-in: the Activity page threw on it.
  // A use passes when a `!Intl.RelativeTimeFormat` guard is within 30 lines
  // above it, or it is the lazy per-locale factory format.ts only calls after one.
  const unguarded: string[] = [];
  for (const file of sources()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (
        !/Intl\.RelativeTimeFormat/.test(line) ||
        /!Intl\.RelativeTimeFormat/.test(line)
      )
        return;
      if (/\(locale\) => new Intl\.RelativeTimeFormat/.test(line)) return;
      const above = lines.slice(Math.max(0, i - 30), i).join('\n');
      if (!/!Intl\.RelativeTimeFormat/.test(above))
        unguarded.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(unguarded, []);
});
