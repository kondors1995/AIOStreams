import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  barsIn,
  combineBars,
  edgesIn,
  zoomFor,
} from './src/lib/playback/bars.ts';

const W = 96;
const H = 54;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** An RGBA frame whose rows `bar` from each edge are black and the rest `rest`. */
function frame(
  bar: number,
  rest: (x: number, y: number) => number,
  bottomBar = bar
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const value = y < bar || y >= H - bottomBar ? 0 : rest(x, y);
      data.set([value, value, value, 255], (y * W + x) * 4);
    }
  return data;
}

test('a picture that fills the frame has no bars', () => {
  assert.equal(
    barsIn(
      frame(0, () => 120),
      W,
      H
    ),
    0
  );
});

test('measures letterbox bars as a share of the height', () => {
  assert.equal(
    barsIn(
      frame(7, () => 120),
      W,
      H
    ),
    7 / H
  );
});

test('takes the thinner bar when the two differ', () => {
  assert.equal(
    barsIn(
      frame(7, () => 120, 4),
      W,
      H
    ),
    4 / H
  );
});

test('a dark scene or a fade says nothing of bars', () => {
  assert.equal(
    barsIn(
      frame(0, () => 0),
      W,
      H
    ),
    null
  );
  assert.equal(barsIn(new Uint8ClampedArray(W * H * 4), W, H), null);
});

test('a bright pixel in a row ends the bar there (subtitles in the bar)', () => {
  const data = frame(8, () => 120);
  data.set([255, 255, 255, 255], (3 * W + 40) * 4);
  assert.equal(barsIn(data, W, H), 3 / H);
});

test('near-black noise still counts as bar', () => {
  assert.equal(
    barsIn(
      frame(6, () => 120).map((v, i) => (v === 0 && i % 4 !== 3 ? 12 : v)),
      W,
      H
    ),
    6 / H
  );
});

test('the middle frame decides, so one odd frame is outvoted', () => {
  // Crystal Lake's frames: 22, 22 and 4 rows of 180 (a bright graphic in the bar).
  assert.ok(near(combineBars([22 / 180, 22 / 180, 4 / 180]), 22 / 180 + 0.005));
  assert.ok(
    near(combineBars([22 / 180, 40 / 180, 22 / 180]), 22 / 180 + 0.005)
  );
});

test('two frames take the smaller, one is trusted, none is none, and there is a cap', () => {
  assert.ok(near(combineBars([0.12, 0.02]), 0.025));
  assert.ok(near(combineBars([0.1]), 0.105));
  assert.equal(combineBars([0, 0, 0]), 0);
  assert.equal(combineBars([]), 0);
  assert.equal(combineBars([0.45, 0.45, 0.45]), 0.3);
});

/** A 320x180 frame with `rows` black rows top and bottom and `cols` black columns at each side. */
function framed(rows: number, cols: number): Uint8ClampedArray {
  const w = 320;
  const h = 180;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const bar = y < rows || y >= h - rows || x < cols || x >= w - cols;
      data.set(
        [bar ? 0 : 120, bar ? 0 : 120, bar ? 0 : 120, 255],
        (y * w + x) * 4
      );
    }
  return data;
}

test('finds a letterbox, a pillarbox, and both at once', () => {
  assert.deepEqual(edgesIn(framed(22, 0), 320, 180), {
    rows: 22 / 180,
    cols: 0,
  });
  assert.deepEqual(edgesIn(framed(0, 40), 320, 180), {
    rows: 0,
    cols: 40 / 320,
  });
  // NCIS: a 16:9 picture letterboxed in a 4:3 video, as YouTube draws it in 16:9.
  assert.deepEqual(edgesIn(framed(22, 40), 320, 180), {
    rows: 22 / 180,
    cols: 40 / 320,
  });
});

test('the zoom fills the card from whichever bars need it more', () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  // A 2.35:1 film in 16:9: the rows decide.
  assert.ok(near(zoomFor(22 / 180, 0), 1 / (1 - 44 / 180)));
  // A 4:3 show: the columns, 4/3 (what `cover` does at the card's size).
  assert.ok(near(zoomFor(0, 40 / 320), 1 / (1 - 80 / 320)));
  // NCIS: the pillarbox's 4/3, the letterbox's 1.32 inside it.
  assert.ok(near(zoomFor(22 / 180, 40 / 320), 4 / 3));
  assert.equal(zoomFor(0, 0), 1);
});
