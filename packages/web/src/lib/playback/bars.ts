/**
 * How far a YouTube trailer's picture must be enlarged to fill a 16:9 card, from
 * the black bars its own frames carry: a letterbox (a widescreen film in a 16:9
 * upload), a pillarbox (a 4:3 show), or both (a 16:9 picture letterboxed in a 4:3
 * video, then pillarboxed in 16:9 as YouTube shows it). A Samsung TV draws its
 * video on a plane the page can't read, so this looks at frames YouTube keeps
 * as pictures, which allow it, instead.
 */

/* The frames are 320x180: read as they are, so a bar's edge isn't rounded away. */
const WIDTH = 320;
const HEIGHT = 180;
/** Cropped past what was seen, so JPEG ringing at a bar's edge leaves no thin line. */
const MARGIN = 0.005;
/** Brightest channel a bar's pixel may have. */
const LEVEL = 24;
/** Never more than this, whatever the frames say. */
const MOST = 0.3;
/** A quarter, half and three quarters into the trailer. */
const FRAMES = ['mq1', 'mq2', 'mq3'];

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/** The share of a frame's height the rows of black at its top and bottom take, and of its width the columns at its sides. */
export interface Edges {
  rows: number;
  cols: number;
}

/**
 * The bars of a frame, from its RGBA pixels at `width` x `height`: for each
 * axis the thinner of its two. Null for an all-dark frame (a fade, a black
 * frame), which says nothing of bars.
 */
export function edgesIn(
  data: ArrayLike<number>,
  width: number,
  height: number
): Edges | null {
  const dark = (x: number, y: number) =>
    Math.max(
      data[(y * width + x) * 4],
      data[(y * width + x) * 4 + 1],
      data[(y * width + x) * 4 + 2]
    ) <= LEVEL;
  const darkRow = (y: number) => {
    for (let x = 0; x < width; x++) if (!dark(x, y)) return false;
    return true;
  };
  const darkCol = (x: number) => {
    for (let y = 0; y < height; y++) if (!dark(x, y)) return false;
    return true;
  };
  let top = 0;
  while (top < height / 2 && darkRow(top)) top++;
  if (top >= height / 2) return null;
  let bottom = 0;
  while (bottom < height / 2 && darkRow(height - 1 - bottom)) bottom++;
  let left = 0;
  while (left < width / 2 && darkCol(left)) left++;
  let right = 0;
  while (right < width / 2 && darkCol(width - 1 - right)) right++;
  return {
    rows: Math.min(top, bottom) / height,
    cols: Math.min(left, right) / width,
  };
}

/** The letterbox alone: `edgesIn`'s rows. */
export const barsIn = (
  data: ArrayLike<number>,
  width: number,
  height: number
) => edgesIn(data, width, height)?.rows ?? null;

/** One frame's edges; null for a frame that can't be read or is all dark. */
function edgesOf(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement
): Edges | null {
  try {
    context.drawImage(image, 0, 0, WIDTH, HEIGHT);
    return edgesIn(
      context.getImageData(0, 0, WIDTH, HEIGHT).data,
      WIDTH,
      HEIGHT
    );
  } catch {
    return null;
  }
}

/**
 * One bar share from the frames' own: the middle one, so a frame with a
 * bright title or subtitle in the bar (smaller) or a dark scene at its edges
 * (larger) is outvoted by the others. With two frames the smaller, to err
 * towards showing the picture whole; none, none; never more than `MOST`.
 */
export function combineBars(bars: number[]): number {
  if (!bars.length) return 0;
  const sorted = [...bars].sort((a, b) => a - b);
  const middle =
    sorted.length === 2
      ? sorted[0]
      : sorted[Math.floor((sorted.length - 1) / 2)];
  return middle > 0 ? Math.min(middle + MARGIN, MOST) : 0;
}

/**
 * How much larger than the card the video is drawn, `contain`-fitted as YouTube
 * draws its frames, for the picture inside the bars to fill it: the larger of
 * what the rows and the columns need, so a 4:3 show comes out as if covered.
 */
export function zoomFor(rows: number, cols: number): number {
  return 1 / (1 - 2 * Math.max(rows, cols));
}

/** The zoom for a YouTube trailer, from three of its frames; null where none can be read. */
export async function trailerZoom(videoId: string): Promise<number | null> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // Fetched together; the canvas is read one frame at a time, as each arrives.
  const frames = await Promise.all(
    FRAMES.map((frame) =>
      load(`https://i.ytimg.com/vi/${videoId}/${frame}.jpg`).then(
        (image) => image,
        () => null
      )
    )
  );
  const edges: Edges[] = [];
  for (const image of frames) {
    const found = image && edgesOf(context, image);
    if (found) edges.push(found);
  }
  if (!edges.length) return null;
  return zoomFor(
    combineBars(edges.map((e) => e.rows)),
    combineBars(edges.map((e) => e.cols))
  );
}
