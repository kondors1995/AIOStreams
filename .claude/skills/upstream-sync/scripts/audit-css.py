#!/usr/bin/env python3
"""Counts CSS features Chromium 69 can't parse that are still in the standalone build's CSS.

Usage: audit-css.py [css folder, default packages/web/dist-standalone/static/css]
Counts are what is *present*, not what is broken: the fallbacks sit beside the originals. Compare with BASELINE
(tizen-5.5 at the first release) to spot something new, then confirm in the probe page. Exits 1 when a kind of CSS
not in BASELINE shows up; growth of a known kind is printed, not failed.
"""
import glob, re, sys

BASELINE = {  # tizen-5.5 at da45b633, the first release (tizen-v0.6.0-1)
    'min( / max( (Chrome 79)': 70,
    ':where( (88)': 87,
    ':has( (105)': 32,
    'overflow: clip (90)': 1,
    'dvh/svh/lvh (108)': 11,
    'aspect-ratio (88)': 14,
    'flex gap (84)': 51,
    'backdrop-filter (76)': 15,
    'scrollbar-width (121)': 5,
    'content-visibility (85)': 4,
    'contain-intrinsic-size (83)': 2,
    'text-wrap (114)': 1,
}
CHECKS = {
    'min( / max( (Chrome 79)': r'(?<![\w-])(?:min|max)\(',
    'clamp( (79)': r'(?<![\w-])clamp\(',
    ':where( (88)': r':where\(',
    ':has( (105)': r':has\(',
    'inset-inline/-block (87)': r'inset-(?:inline|block)',
    'margin/padding inline|block shorthand (87)': r'(?:margin|padding)-(?:inline|block):',
    'logical corner radius (89)': r'border-(?:start|end)-(?:start|end)-radius',
    'overflow: clip (90)': r'overflow(?:-[xy])?:\s*clip',
    'dvh/svh/lvh (108)': r'\d(?:d|s|l)vh',
    'aspect-ratio (88)': r'aspect-ratio',
    'flex gap (84)': r'(?<![\w-])(?:row-|column-)?gap:',
    'backdrop-filter (76)': r'backdrop-filter',
    'color-scheme (81)': r'color-scheme',
    'accent-color (93)': r'accent-color',
    'scrollbar-width (121)': r'scrollbar-width',
    'content-visibility (85)': r'content-visibility',
    'contain-intrinsic-size (83)': r'contain-intrinsic-size',
    'text-wrap (114)': r'text-wrap',
    'translate/rotate/scale properties (104)': r'(?<![\w-])(?:translate|rotate|scale):',
    '@starting-style / transition-behavior': r'@starting-style|transition-behavior',
    'lab()/oklch()/color-mix() (111)': r'(?:lab|oklch|oklab|color-mix)\(',
    '@container (105)': r'@container',
    '@layer (99)': r'@layer',
    'CSS nesting & (120)': r'(?<![\w\\])&[\s.:#\[]',
    'anchor positioning': r'anchor-name|position-anchor',
}
folder = sys.argv[1] if len(sys.argv) > 1 else 'packages/web/dist-standalone/static/css'
files = glob.glob(folder + '/*.css')
if not files:
    sys.exit(f'no CSS in {folder}: build first (pnpm -F @aiostreams/web build:standalone)')
css = ''.join(open(f).read() for f in files)
print(f'{len(css)} bytes of CSS')
for name, pattern in CHECKS.items():
    n = len(re.findall(pattern, css))
    base = BASELINE.get(name)
    note = '' if base is None else ('' if n == base else f'   (baseline {base}: {"+" if n > base else ""}{n - base})')
    if n or base:
        print(f'{n:6}  {name}{note}')
new = [k for k, p in CHECKS.items() if k not in BASELINE and re.search(p, css)]
grown = [k for k, b in BASELINE.items() if len(re.findall(CHECKS[k], css)) > b]
if grown:
    print('\nMore than the baseline (look at what upstream added; the fallbacks cover gap, aspect-ratio, dvh, min/max and logical properties):', ', '.join(grown))
if new:
    print('\nNOT in the baseline, now present:', ', '.join(new))
    print('A kind of CSS Chromium 69 cannot parse is new: check it in the probe page, add a fallback in legacy-css.ts or accept it, then add it to BASELINE.')
    sys.exit(1)
