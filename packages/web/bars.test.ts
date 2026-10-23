import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barsIn } from './src/lib/playback/bars.ts';

const W = 96;
const H = 54;

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
