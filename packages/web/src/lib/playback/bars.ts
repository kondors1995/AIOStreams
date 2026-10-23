/**
 * How much of a YouTube trailer's height is black bar, top and bottom, that
 * its own frames carry (a widescreen film in a 16:9 upload). A Samsung TV
 * draws its video on a plane the page can't read, so this looks at frames
 * YouTube keeps as pictures, which allow it, instead.
 */

const WIDTH = 96;
const HEIGHT = 54;
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

/** How much of one frame's height each bar takes; null for a frame that can't be read or is all dark. */
function barOf(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement
): number | null {
  try {
    context.drawImage(image, 0, 0, WIDTH, HEIGHT);
    const { data } = context.getImageData(0, 0, WIDTH, HEIGHT);
    const dark = (y: number) => {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        if (Math.max(data[i], data[i + 1], data[i + 2]) > LEVEL) return false;
      }
      return true;
    };
    let top = 0;
    while (top < HEIGHT / 2 && dark(top)) top++;
    let bottom = 0;
    while (bottom < HEIGHT / 2 && dark(HEIGHT - 1 - bottom)) bottom++;
    // All dark: a fade or a black frame, which says nothing of bars.
    return top < HEIGHT / 2 ? Math.min(top, bottom) / HEIGHT : null;
  } catch {
    return null;
  }
}

/** The share of the height each bar takes, 0 to 0.3: the smallest the frames show, 0 where none can be read. */
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
  return bars.length ? Math.min(Math.min(...bars), MOST) : 0;
}
