/**
 * How much of a YouTube trailer's height is black bar, top and bottom, that
 * its own frames carry (a widescreen film in a 16:9 upload). A Samsung TV
 * draws its video on a plane the page can't read, so this looks at frames
 * YouTube keeps as pictures, which allow it, instead.
 */

/* The frames are 320x180: read at their own height, so a bar's edge isn't rounded away. */
const WIDTH = 64;
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

/**
 * How much of a frame's height each bar takes, from its RGBA pixels at
 * `width` x `height`: the thinner of the black rows at its top and bottom.
 * Null for an all-dark frame (a fade, a black frame), which says nothing of bars.
 */
export function barsIn(
  data: ArrayLike<number>,
  width: number,
  height: number
): number | null {
  const dark = (y: number) => {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.max(data[i], data[i + 1], data[i + 2]) > LEVEL) return false;
    }
    return true;
  };
  let top = 0;
  while (top < height / 2 && dark(top)) top++;
  let bottom = 0;
  while (bottom < height / 2 && dark(height - 1 - bottom)) bottom++;
  return top < height / 2 ? Math.min(top, bottom) / height : null;
}

/** One frame's bars; null for a frame that can't be read or is all dark. */
function barOf(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement
): number | null {
  try {
    context.drawImage(image, 0, 0, WIDTH, HEIGHT);
    return barsIn(
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

/** The share of the height each bar takes, 0 to 0.3, from YouTube's frames of the trailer; 0 where none can be read. */
export async function blackBars(videoId: string): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return 0;
  // Fetched together; the canvas is read one frame at a time, as each arrives.
  const frames = await Promise.all(
    FRAMES.map((frame) =>
      load(`https://i.ytimg.com/vi/${videoId}/${frame}.jpg`).then(
        (image) => image,
        () => null
      )
    )
  );
  const bars: number[] = [];
  for (const image of frames) {
    if (!image) continue;
    const bar = barOf(context, image);
    if (bar !== null) bars.push(bar);
  }
  return combineBars(bars);
}
