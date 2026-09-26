#!/usr/bin/env bun
/**
 * @fileoverview Headless-Chrome stills of the running app, for visual review and README images.
 * Drives the page over the DevTools Protocol (no npm dependencies) through the `window.tonoscope`
 * debug handle, plays scripted notes, and saves PNGs.
 *
 *   bun run snapshot                          # every vessel, default notes → stills/
 *   bun run snapshot --url http://127.0.0.1:5199/ --out stills --width 1600 --height 1000
 *   bun run snapshot --scenes "0:9,2:14+17" --settle 4
 *   bun run snapshot --width 390 --height 844 --about   # phone width, plus the about panel
 *
 * A scene is `<vessel>:<degree>[+<degree>...]`. The dev server (`bun run dev`) must be running.
 * @module scripts/snapshot
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

const url = flag('url', 'http://127.0.0.1:5199/');
const outDir = resolve(flag('out', 'stills'));
const width = Number(flag('width', '1600'));
const height = Number(flag('height', '1000'));
const settle = Number(flag('settle', '4.5'));
const scenes = flag('scenes', '0:10,1:12,2:13,3:12')
  .split(',')
  .map((scene) => {
    const [vessel, degrees] = scene.split(':');
    return { vessel: Number(vessel), degrees: (degrees ?? '9').split('+').map(Number) };
  });

interface CdpReply {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

async function devtoolsTarget(profile: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const file = Bun.file(join(profile, 'DevToolsActivePort'));
    if (await file.exists()) {
      const [port] = (await file.text()).split('\n');
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    }
    await Bun.sleep(100);
  }
  throw new Error('Chrome did not expose a DevTools page target within 15 s');
}

const profile = await mkdtemp(join(tmpdir(), 'tonoscope-chrome-'));
const chrome = Bun.spawn(
  [
    CHROME,
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--enable-unsafe-webgpu',
    '--enable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

const ws = new WebSocket(await devtoolsTarget(profile));
await new Promise((ok, fail) => {
  ws.addEventListener('open', ok, { once: true });
  ws.addEventListener('error', () => fail(new Error('DevTools websocket failed')), { once: true });
});

let seq = 0;
const pending = new Map<number, (reply: CdpReply) => void>();
const errors: string[] = [];
ws.addEventListener('message', (event) => {
  const reply = JSON.parse(String(event.data)) as CdpReply;
  if (reply.id !== undefined) pending.get(reply.id)?.(reply);
  if (reply.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(reply.params));
  if (reply.method === 'Runtime.consoleAPICalled') {
    const params = reply.params as { type: string; args: { value?: unknown }[] };
    const text = params.args.map((a) => String(a.value ?? '')).join(' ');
    if (params.type === 'error' || params.type === 'warning')
      errors.push(`${params.type}: ${text}`);
    else console.log(`page: ${text}`);
  }
});

function send(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    seq += 1;
    pending.set(seq, (reply) =>
      reply.error ? fail(new Error(`${method}: ${reply.error.message}`)) : ok(reply.result ?? {}),
    );
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
}

async function evaluate(expression: string): Promise<unknown> {
  const reply = (await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  if (reply.exceptionDetails)
    throw new Error(`page threw: ${JSON.stringify(reply.exceptionDetails)}`);
  return reply.result?.value;
}

async function shoot(name: string): Promise<void> {
  const { data } = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  const file = join(outDir, `${name}.png`);
  await Bun.write(file, Buffer.from(data, 'base64'));
  console.log(file);
}

try {
  await mkdir(outDir, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url });
  await Bun.sleep(1500);
  const ready = await evaluate(
    `new Promise((ok) => { const t = setInterval(() => { if (window.tonoscope || document.querySelector('.unsupported:not([hidden])')) { clearInterval(t); ok(!!window.tonoscope); } }, 100); })`,
  );
  if (!ready) {
    await shoot('unsupported');
    throw new Error('The page reported that WebGPU is unavailable in headless Chrome');
  }
  await Bun.sleep(settle * 1000);
  await shoot('00-title');
  await evaluate(
    `document.querySelector('[data-action="begin-silent"]').click(); document.querySelector('[data-way="play"]').click();`,
  );

  for (const [i, scene] of scenes.entries()) {
    await evaluate(`window.tonoscope.setVessel(${scene.vessel})`);
    await Bun.sleep(3800);
    await evaluate(
      `(() => { const t = window.tonoscope; const now = performance.now() / 1000;
        ${JSON.stringify(scene.degrees)}.forEach((d) => t.instrument.noteOn(now, d, { velocity: 0.9, pan: 0, bowed: true, source: 'key', holdFor: ${settle} })); })()`,
    );
    await Bun.sleep(settle * 1000);
    await shoot(
      `${String(i + 1).padStart(2, '0')}-vessel${scene.vessel}-deg${scene.degrees.join('+')}`,
    );
  }
  if (args.includes('--about')) {
    await evaluate(`document.querySelector('.utilities [data-action="about"]').click()`);
    await Bun.sleep(900);
    await shoot('99-about');
  }
  const stats = await evaluate(`({ grains: window.tonoscope.particles.count })`);
  console.log('stats', JSON.stringify(stats));
  if (errors.length) console.error(`page errors:\n  ${errors.join('\n  ')}`);
} finally {
  ws.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true });
}
