import React from 'react';
import { useSession } from '../lib/session';
import { settings, useSetting } from '../lib/settings';
import { landscapeUrls } from '../lib/images';
import { itemTitle } from '../lib/format';
import type { BaseItemDto } from '../lib/types';
import { glideBy } from '../lib/input/glide';
import { Artwork } from './cards';
import {
  OPEN_DELAY_MS,
  OpenDetails,
  OpenTitle,
  OpenTrailer,
  READY_MS,
  TRAILER_DELAY_MS,
  TRAILER_LOAD_MS,
} from './open-card';

/**
 * A grid's poster that, once a TV's focus rests on it, opens out (as the home's
 * rows do): three columns wide at 16:9, its details on a band under it, its
 * trailer after a while. The tiles it would cover move out of its way while it
 * is open: those after it in its row slide over, and the rows below slide down
 * by what its band hangs under its own tile. It opens leftward near the grid's
 * right edge, and the page scrolls if its band would pass the screen's bottom. What it shows is made ready under the poster
 * first, so opening only places it and eases it in, on the compositor.
 */

const COLUMNS = 3;
const OPEN_MS = 250;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** Room kept between the opened card and the screen's bottom, which the page scrolls to give it. */
const MARGIN_PX = 16;

/** Where the opened card goes, from the cell, its grid and the screen. */
function place(cell: HTMLElement, overlay: HTMLElement): 'left' | 'right' {
  const grid = cell.closest<HTMLElement>('[data-ui=card-grid]') ?? cell;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const poster =
    cell.querySelector<HTMLElement>('[data-ui=poster-card-image]') ?? cell;
  const at = cell.getBoundingClientRect();
  const bounds = grid.getBoundingClientRect();
  const width = Math.min(
    COLUMNS * at.width + (COLUMNS - 1) * gap,
    bounds.width
  );
  const height = (width * 9) / 16;
  // Leftward where rightward would pass the grid's edge, and never past its start.
  const rightward = at.left + width <= bounds.right + 1;
  let left = rightward ? 0 : at.width - width;
  left = Math.max(left, bounds.left - at.left);
  // From the poster's top, and grown downward, where the rows below make room: the
  // 16:9 frame is taller than a narrow poster, and centred it would cover the row above.
  const top = poster.offsetTop;
  Object.assign(overlay.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
  });
  const frame = overlay.firstElementChild;
  if (frame instanceof HTMLElement) frame.style.height = `${height}px`;
  return rightward ? 'left' : 'right';
}

const reduced = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides the grid's other tiles out of the opened card's way, and returns what
 * slides them back. The tiles near the screen are eased, each a layer while it
 * moves; the rows further down move at once, unseen, so that no row meets one
 * that stayed. A tile with no room left in its row (past the grid's edge) fades
 * out where it is: moved there it would widen the page, and the TV's browser
 * answers a page wider than the screen by zooming the whole of it out.
 */
function pushAside(
  cell: HTMLElement,
  overlay: HTMLElement,
  from: 'left' | 'right'
): () => void {
  const grid = cell.closest<HTMLElement>('[data-ui=card-grid]');
  if (!grid) return () => {};
  // The grid's own child that holds this cell.
  let mine: HTMLElement = cell;
  while (mine.parentElement && mine.parentElement !== grid)
    mine = mine.parentElement;
  const here = mine.getBoundingClientRect();
  const bounds = grid.getBoundingClientRect();
  const card = overlay.getBoundingClientRect();
  const rightward = from === 'left';
  // All the reads first, then the writes.
  const tiles = [...grid.children]
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el !== mine)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }));
  const extra = Math.max(0, card.width - here.width);
  const rowOf = (top: number) => Math.abs(top - here.top) < here.height / 2;
  const below = tiles.filter(({ rect }) => rect.top >= here.bottom - 1);
  const nextTop = Math.min(...below.map(({ rect }) => rect.top));
  const down = below.length
    ? Math.max(0, Math.ceil(card.bottom + 12 - nextTop))
    : 0;
  const timing: KeyframeAnimationOptions = {
    duration: reduced() ? 0 : OPEN_MS,
    easing: EASE,
    fill: 'both',
  };
  const moved: Animation[] = [];
  const unseen: HTMLElement[] = [];
  for (const { el, rect } of tiles) {
    const seen = rect.bottom > -100 && rect.top < innerHeight + 300;
    if (rowOf(rect.top)) {
      const dx = rightward
        ? rect.left > here.left
          ? extra
          : 0
        : rect.left < here.left
          ? -extra
          : 0;
      if (!dx) continue;
      const hidden = rightward
        ? rect.right + dx > bounds.right + 1
        : rect.left + dx < bounds.left - 1;
      moved.push(
        el.animate(
          hidden
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [{ transform: 'none' }, { transform: `translate(${dx}px, 0)` }],
          timing
        )
      );
    } else if (down && rect.top >= here.bottom - 1) {
      if (seen)
        moved.push(
          el.animate(
            [{ transform: 'none' }, { transform: `translate(0, ${down}px)` }],
            timing
          )
        );
      else {
        el.style.transform = `translate(0, ${down}px)`;
        unseen.push(el);
      }
    }
  }
  return () => {
    for (const el of unseen) el.style.transform = '';
    for (const animation of moved) {
      animation.onfinish = () => animation.cancel();
      animation.reverse();
    }
  };
}

export function GridOpenCard({
  item,
  children,
}: {
  item: BaseItemDto;
  /** The grid's own poster card, which keeps focus. */
  children: React.ReactNode;
}) {
  const { client } = useSession();
  const [trailers] = useSetting(settings.interface.discoverTrailers);
  const [ready, setReady] = React.useState(false);
  const [loadTrailer, setLoadTrailer] = React.useState(false);
  const [playTrailer, setPlayTrailer] = React.useState(false);
  const cell = React.useRef<HTMLDivElement>(null);
  const overlay = React.useRef<HTMLDivElement>(null);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  // Slides the tiles it moved back.
  const release = React.useRef<(() => void) | null>(null);
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const shut = () => {
    const el = overlay.current;
    if (el) {
      el.removeAttribute('data-open');
      el.style.visibility = 'hidden';
    }
    if (cell.current) cell.current.style.zIndex = '';
    release.current?.();
    release.current = null;
  };
  const open = () => {
    const box = cell.current;
    const el = overlay.current;
    if (!box || !el) return;
    const from = place(box, el);
    release.current?.();
    release.current = pushAside(box, el, from);
    // Its band past the screen's bottom: the page scrolls to show it.
    const over = el.getBoundingClientRect().bottom + MARGIN_PX - innerHeight;
    if (over > 0) glideBy(document.documentElement, 0, over);
    box.style.zIndex = '20';
    el.style.visibility = 'visible';
    el.setAttribute('data-open', '');
    el.style.transformOrigin = `${from} center`;
    el.animate(
      [
        { opacity: 0, transform: 'scale(0.92)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: OPEN_MS, easing: EASE }
    );
  };
  React.useEffect(
    () => () => {
      stop();
      release.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // Sized as it mounts, so its picture is asked for and drawn before it opens.
  React.useLayoutEffect(() => {
    if (ready && cell.current && overlay.current)
      place(cell.current, overlay.current);
  }, [ready]);
  // Focus moving between the poster and a control in the same cell is no change.
  const within = (e: React.FocusEvent) =>
    e.relatedTarget instanceof Node &&
    !!cell.current?.contains(e.relatedTarget);
  const onFocus = (e: React.FocusEvent) => {
    if (within(e)) return;
    stop();
    timers.current = [
      setTimeout(() => setReady(true), READY_MS),
      setTimeout(open, OPEN_DELAY_MS),
      ...(trailers
        ? [
            setTimeout(() => setLoadTrailer(true), TRAILER_LOAD_MS),
            setTimeout(
              () => setPlayTrailer(true),
              OPEN_DELAY_MS + TRAILER_DELAY_MS
            ),
          ]
        : []),
    ];
  };
  const onBlur = (e: React.FocusEvent) => {
    if (within(e)) return;
    stop();
    shut();
    setReady(false);
    setLoadTrailer(false);
    setPlayTrailer(false);
  };
  const title = itemTitle(item);
  return (
    <div
      ref={cell}
      data-ui="grid-open-cell"
      className="relative"
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
      {ready && (
        <div
          ref={overlay}
          data-ui="grid-open-card"
          aria-hidden
          // Drawn, so ready, but unseen until it opens; a layer of its own ahead.
          className="pointer-events-none invisible absolute left-0 top-0 will-change-transform"
        >
          {/* A layer of its own, as the home's frame is: a Samsung TV draws a trailer's picture only inside one (the sound alone plays otherwise). */}
          <div className="relative overflow-hidden rounded-lg bg-gray-900 ring-[3px] ring-white will-change-transform">
            <Artwork
              src={(width) => landscapeUrls(client, item, { maxWidth: width })}
              alt={title}
            />
            {loadTrailer && <OpenTrailer item={item} play={playTrailer} />}
            <OpenTitle item={item} />
          </div>
          <div className="-mt-2 rounded-b-lg bg-gray-950/95 px-3 pb-3 pt-4 shadow-2xl">
            <OpenDetails item={item} />
          </div>
        </div>
      )}
    </div>
  );
}
