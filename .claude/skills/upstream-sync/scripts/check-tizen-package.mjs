#!/usr/bin/env node
// Boots the packaged Tizen app (packages/smart-tv/out/tizen) in the local Chromium 69, the engine of the 2020 TV, and checks:
//   1. every JS file parses (a syntax newer than Chromium 69 anywhere in the build fails here, not on the TV);
//   2. the app starts: no exception or console error, something is drawn (the "Add a server" page, as no server is set);
//   3. boot.js set the feature classes the CSS fallbacks hang on.
// Usage: check-tizen-package.mjs [package dir]   Needs ~/tizen-dl/chromium69 (notes/aiostreams-tv.md), or CHROMIUM69=<path to
// its chrome binary>; CI downloads snapshot 576753 (69.0.3497.0). Exit 1 on a failure.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = path.resolve(process.argv[2] ?? 'packages/smart-tv/out/tizen');
const chromePath =
  process.env.CHROMIUM69 ??
  path.join(os.homedir(), 'tizen-dl/chromium69/chrome-linux/chrome');
if (!fs.existsSync(path.join(dir, 'index.html')))
  throw new Error(`no package in ${dir}: build it first`);
if (!fs.existsSync(chromePath))
  throw new Error(
    `no Chromium 69 at ${chromePath} (see notes/aiostreams-tv.md)`
  );

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  const file = path.join(
    dir,
    decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')
  );
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium69-check-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const failures = [];
const finish = (code) => {
  chrome.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};
try {
  let tabs;
  for (let i = 0; i < 50 && !tabs; i++) {
    await new Promise((r) => setTimeout(r, 200));
    tabs = await fetch(`http://localhost:${port}/json`).then(
      (r) => r.json(),
      () => null
    );
  }
  if (!tabs) throw new Error('Chromium 69 did not start');
  const ws = new WebSocket(
    tabs.find((t) => t.type === 'page').webSocketDebuggerUrl
  );
  let id = 0;
  const pending = new Map();
  const problems = [];
  const call = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (pending.has(m.id)) pending.get(m.id)(m.result);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(
        'exception: ' +
          String((d.exception && d.exception.description) || d.text).slice(
            0,
            240
          )
      );
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      problems.push(
        'console.error: ' +
          m.params.args
            .map((a) => a.value || a.description)
            .join(' ')
            .slice(0, 240)
      );
  };
  await new Promise((r) => (ws.onopen = r));
  await call('Runtime.enable');
  await call('Page.enable');
  const evaluate = async (expression) =>
    (
      await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result?.value;

  // 1. every script parses (parsed, not run: new Function throws a SyntaxError on one Chromium 69 can't read)
  await call('Page.navigate', { url: `${base}/index.html` });
  // Until the app has drawn something (20 s at most), then a moment for late errors.
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const drawn = await evaluate(
      `(document.getElementById('root') || { children: [] }).children.length`
    );
    if (drawn > 0) break;
  }
  await new Promise((r) => setTimeout(r, 1500));
  const scripts = fs
    .readdirSync(path.join(dir, 'static'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => 'static/' + f.split(path.sep).join('/'))
    .concat('boot.js');
  const bad = JSON.parse(
    await evaluate(
      `(async () => { var bad = []; var files = ${JSON.stringify(scripts)}; for (var i = 0; i < files.length; i++) { var t = await (await fetch('/' + files[i])).text(); try { new Function(t); } catch (e) { bad.push(files[i] + ': ' + e); } } return JSON.stringify(bad); })()`
    )
  );
  console.log(
    `${bad.length ? 'FAIL' : 'ok  '}  ${scripts.length} scripts parse in Chromium 69`
  );
  failures.push(...bad);

  // 2 + 3. the app started, and boot.js ran
  const state = JSON.parse(
    await evaluate(
      `JSON.stringify({ classes: document.documentElement.className, children: (document.getElementById('root') || { children: [] }).children.length, text: document.body.innerText.slice(0, 80), ua: navigator.userAgent.match(/Chrome\\/[0-9.]+/)[0] })`
    )
  );
  console.log(`      engine ${state.ua}`);
  const started = state.children > 0 && state.text.trim().length > 0;
  console.log(
    `${started ? 'ok  ' : 'FAIL'}  the app draws its first page: ${JSON.stringify(state.text.split('\n').filter(Boolean)[0] ?? '')}`
  );
  if (!started) failures.push('nothing drawn');
  const want = [
    'no-focus-visible',
    'no-aspect-ratio',
    'no-flex-gap',
    'no-logical-props',
    'no-min-max',
  ];
  const missing = want.filter((c) => !state.classes.split(' ').includes(c));
  console.log(
    `${missing.length ? 'FAIL' : 'ok  '}  boot.js feature classes (${state.classes.trim()})`
  );
  failures.push(...missing.map((c) => 'class missing: ' + c));
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '}  no exceptions or console errors while starting`
  );
  failures.push(...problems);
} catch (error) {
  failures.push(String(error));
}
if (failures.length) {
  console.log('\n' + failures.map((f) => '  - ' + f).join('\n'));
  finish(1);
}
finish(0);
