import type { Plugin, Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Keeps the standalone build working on Chromium 69 (2020 Samsung TVs), which
 * drops whole rules over selectors it doesn't know. `:is()` lists are
 * expanded; `:focus-visible`, flex `gap`, `aspect-ratio`, `start-*`/`end-*` and
 * logical corner radii, and the sizes in `min()`/`max()` get stand-ins that
 * apply under the classes the TV apps' `boot.js` puts on `<html>` when the
 * engine lacks them.
 * `:where()` rules are left out: unwrapped, Tailwind's form resets would
 * outrank the utilities.
 */
export function legacyCss(): Plugin {
  return {
    postcssPlugin: 'aiostreams-legacy-css',
    OnceExit(root) {
      root.walkRules((rule) => {
        if (rule.selector.includes(':is(')) {
          rule.selectors = [...new Set(rule.selectors.flatMap(expandIs))];
        }
        // A class name's escaped `\:focus-visible` isn't the pseudo-class.
        const focusVisible = /(?<!\\):focus-visible/g;
        if (focusVisible.test(rule.selector)) {
          rule.cloneAfter({
            selectors: rule.selectors.map((s) =>
              under('no-focus-visible', s.replace(focusVisible, ':focus'))
            ),
          });
        }
      });
      root.walkDecls((decl) => {
        if (/\ddvh\b/.test(decl.value)) {
          decl.cloneBefore({ value: decl.value.replace(/(\d)dvh\b/g, '$1vh') });
        }
      });
      // Logical properties with no longhand to fall back on: Lightning CSS
      // writes them with `:lang()` selectors this engine drops as well.
      root.walkDecls(LOGICAL_PROP, (decl) => {
        const rule = decl.parent as Rule;
        if (rule.type !== 'rule') return;
        const [ltr, rtl] = LOGICAL[decl.prop];
        for (const [side, extra] of [
          [ltr, ':not([dir=rtl])'],
          [rtl, '[dir=rtl]'],
        ] as const) {
          rule
            .cloneAfter({
              selectors: rule.selectors.map((s) =>
                under('no-logical-props', s, extra)
              ),
            })
            .removeAll()
            .append({
              prop: side,
              value: decl.value,
              important: decl.important,
            });
        }
      });
      // `min()` and `max()` (Chromium 79) as their first argument, the size a
      // rule starts from; a custom property takes the last value, so its
      // stand-in is a rule of its own.
      root.walkDecls((decl) => {
        if (!MIN_MAX.test(decl.value)) return;
        const value = firstArguments(decl.value);
        const rule = decl.parent as Rule;
        if (!decl.prop.startsWith('--'))
          return void decl.cloneBefore({ value });
        if (rule.type !== 'rule') return;
        rule
          .cloneAfter({
            selectors: rule.selectors.map((s) => under('no-min-max', s)),
          })
          .removeAll()
          .append({ prop: decl.prop, value, important: decl.important });
      });
      root.walkDecls('aspect-ratio', (decl) => {
        const rule = decl.parent as Rule;
        if (rule.type !== 'rule') return;
        const [width, height = '1'] = decl.value
          .split('/')
          .map((n) => n.trim());
        const percent = (Number(height) / Number(width)) * 100;
        if (!Number.isFinite(percent)) return;
        const padding = `${+percent.toFixed(4)}%`;
        // A single-class utility's pseudo-element, as `before:aspect-video`, can't take
        // another; its own padding sizes it, as one spanning its box's width does.
        if (/^\.(?:[^\s,>+~:\\]|\\.)+::?(before|after)$/.test(rule.selector)) {
          rule
            .cloneAfter({
              selectors: [under('no-aspect-ratio', rule.selector)],
            })
            .removeAll()
            .append(
              { prop: 'height', value: '0' },
              { prop: 'padding-top', value: padding }
            );
          return;
        }
        // Single-class utilities only.
        if (!/^\.(?:[^\s,>+~:\\]|\\.)+$/.test(rule.selector)) return;
        // A float's padding gives the box its height; the content sits over it.
        rule
          .cloneAfter({
            selectors: [under('no-aspect-ratio', `${rule.selector}:before`)],
          })
          .removeAll()
          .append(
            { prop: 'content', value: '""' },
            { prop: 'float', value: 'left' },
            { prop: 'padding-top', value: padding }
          );
        rule
          .cloneAfter({
            selectors: [under('no-aspect-ratio', `${rule.selector}:after`)],
          })
          .removeAll()
          .append(
            { prop: 'content', value: '""' },
            { prop: 'display', value: 'block' },
            { prop: 'clear', value: 'both' }
          );
      });
      // Breakpoint variants that turn a flex box, e.g. `.sm\:flex-row`.
      const directions: { rule: Rule; row: boolean }[] = [];
      root.walkDecls('flex-direction', (decl) => {
        const rule = decl.parent as Rule;
        if (
          rule.parent?.type === 'atrule' &&
          /^\.[\w-]+\\:flex-(row|col)$/.test(rule.selector)
        )
          directions.push({ rule, row: decl.value === 'row' });
      });
      // `.flex-wrap` and its breakpoint variants.
      const wraps: Rule[] = [];
      root.walkDecls('flex-wrap', (decl) => {
        const rule = decl.parent as Rule;
        if (
          decl.value === 'wrap' &&
          /^\.([\w-]+\\:)?flex-wrap$/.test(rule.selector)
        )
          wraps.push(rule);
      });
      root.walkDecls(/^(gap|row-gap|column-gap)$/, (decl) => {
        const rule = decl.parent as Rule;
        // Only Tailwind's single-class utilities, e.g. `.gap-2` or `.sm\:gap-x-4`.
        if (rule.type !== 'rule' || !/^\.[^\s,>+~]+$/.test(rule.selector))
          return;
        const [rowGap, columnGap = rowGap] = decl.value.split(/\s+/);
        // Each class sets only its own axis' margin, so `gap-x-2 gap-y-1` combine.
        const right = decl.prop !== 'row-gap';
        const bottom = decl.prop !== 'column-gap';
        const margins = (r?: string, b?: string) => ({
          // Logical, so a right-to-left row spaces its own end; Chromium 69 has it.
          ...(right && r !== undefined && { 'margin-inline-end': r }),
          ...(bottom && b !== undefined && { 'margin-bottom': b }),
        });
        const sel = rule.selector;
        const items = '>:not(:last-child)';
        const add = (
          after: Rule,
          selectors: string[],
          decls: Record<string, string>
        ) => {
          if (!Object.keys(decls).length) return;
          after
            .cloneAfter({
              selectors: selectors.map((s) => under('no-flex-gap', s)),
            })
            .removeAll()
            .append(
              ...Object.entries(decls).map(([prop, value]) => ({ prop, value }))
            );
        };
        add(
          rule,
          [
            `.flex${sel}:not(.flex-col)${items}`,
            `.inline-flex${sel}:not(.flex-col)${items}`,
          ],
          margins(columnGap)
        );
        add(rule, [`.flex-col${sel}${items}`], margins(undefined, rowGap));
        // Later in the sheet with equal weight, so a variant beats the box's
        // base direction; it also undoes that direction's margin.
        if (rule.parent?.type !== 'root') return;
        for (const { rule: variant, row } of directions) {
          const twice = variant.selector + variant.selector;
          add(
            variant,
            [`${twice}${sel}${items}`],
            row ? margins(columnGap, '0') : margins('0', rowGap)
          );
        }
        // shortcut: a wrapping row spaces every item below, the last line too.
        for (const wrap of wraps) {
          const thrice = wrap.selector.repeat(3);
          add(wrap, [`${thrice}${sel}>*`], margins(undefined, rowGap));
        }
      });
    },
  };
}

/**
 * `selector` limited to pages whose `<html>` has `className`, and `extra` on
 * it, as `[dir=rtl]`. A selector that starts on `<html>` itself, as the TV's
 * `[data-tv]` and the dark theme's `.dark` do, or on another of these classes,
 * takes the class there.
 */
function under(className: string, selector: string, extra = ''): string {
  const root =
    /^(html(?![\w-])|\[data-tv\]|\.dark(?![\w-])|\.no-(?:focus-visible|flex-gap|aspect-ratio|logical-props|min-max)(?![\w-]))/.exec(
      selector
    );
  if (root)
    return `${root[0]}.${className}${extra}${selector.slice(root[0].length)}`;
  return extra
    ? `html.${className}${extra} ${selector}`
    : `.${className} ${selector}`;
}

const LOGICAL_PROP =
  /^(inset-inline-(start|end)|border-(start|end)-(start|end)-radius)$/;

/** Each logical property as the physical one it is for text running left to right, and right to left. */
const LOGICAL: Record<string, [string, string]> = {
  'inset-inline-start': ['left', 'right'],
  'inset-inline-end': ['right', 'left'],
  'border-start-start-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
  ],
  'border-start-end-radius': [
    'border-top-right-radius',
    'border-top-left-radius',
  ],
  'border-end-start-radius': [
    'border-bottom-left-radius',
    'border-bottom-right-radius',
  ],
  'border-end-end-radius': [
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
};

/** `min(`/`max(`, but not `minmax(`. */
const MIN_MAX = /(?<![\w-])(?:min|max)\(/;

/** `value` split at the commas that aren't inside brackets. */
function topLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

/**
 * Each `min()`/`max()` in `value` as its first argument, or the first that
 * isn't a bare `env()`, which is 0 on a TV: `max(1rem, env(safe-area-inset-left))`
 * is 1rem there.
 */
export function firstArguments(value: string): string {
  for (let found; (found = MIN_MAX.exec(value));) {
    const open = found.index + found[0].length;
    let depth = 1;
    let end = open;
    while (depth && end < value.length) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')') depth--;
      end++;
    }
    const args = topLevelArguments(value.slice(open, end - 1));
    const chosen = args.find((a) => !/^env\(/.test(a)) ?? args[0];
    value = value.slice(0, found.index) + chosen + value.slice(end);
  }
  return value;
}

/** One selector without `:is()`, as the list of selectors it stands for. */
export function expandIs(selector: string): string[] {
  const pseudos: selectorParser.Pseudo[] = [];
  selectorParser((root) => {
    root.walkPseudos((pseudo) => {
      if (pseudo.value === ':is') pseudos.push(pseudo);
    });
  }).processSync(selector);
  const found = pseudos[0];
  if (!found) return [selector];
  const start = found.sourceIndex;
  const text = found.toString().trim();
  const before = selector.slice(0, start);
  const after = selector.slice(start + text.length);
  // Inside another pseudo (`:not(:is(a,b))`), a list of selectors would mean something else.
  const open = before.split('(').length - before.split(')').length;
  if (selector.slice(start, start + text.length) !== text || open > 0) {
    throw new Error(`legacy-css: cannot expand ${text} in ${selector}`);
  }
  return found.nodes.flatMap((arg) => {
    const inner = arg.toString().trim();
    // Tailwind's dark variant, `:is(.dark *)`: inside `.dark`.
    const ancestor = /^(\S+) \*$/.exec(inner);
    if (ancestor) return expandIs(`${ancestor[1]} ${before}${after}`);
    if (
      /[\s>+~]/.test(inner) ||
      (/^[a-z*]/i.test(inner) && /[^\s>+~(]$/.test(before))
    ) {
      throw new Error(`legacy-css: cannot expand ${inner} in ${selector}`);
    }
    return expandIs(before + inner + after);
  });
}
