#!/usr/bin/env node
/**
 * Builds the standalone browser demo and inlines it into one HTML fragment
 * (web/demo/dist/re-studio.html) suitable for static hosting or publishing as
 * a single page. The fragment has no <html>/<head>/<body> wrapper; hosts that
 * need a full document can wrap it.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/demo/dist');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const build = spawnSync(npx, ['vite', 'build', '--config', 'web/demo/vite.config.ts'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const assets = readdirSync(path.join(dist, 'assets'));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length !== 1 || css.length !== 1) {
  console.error(`Expected one JS and one CSS asset, found: ${assets.join(', ')}`);
  process.exit(1);
}

// Keep the inline script from terminating early inside HTML.
const script = readFileSync(path.join(dist, 'assets', js[0]), 'utf8')
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\!--');
const style = readFileSync(path.join(dist, 'assets', css[0]), 'utf8').replace(/<\/style/gi, '<\\/style');

const html = [
  '<title>RE Studio</title>',
  '<meta name="description" content="Requirements engineering for Mendix and OutSystems with best-practice rule engines (browser demo)." />',
  `<style>${style}</style>`,
  '<div id="root"></div>',
  `<script type="module">${script}</script>`,
  '',
].join('\n');

const target = path.join(dist, 're-studio.html');
writeFileSync(target, html);
console.log(`Wrote ${path.relative(root, target)} (${(html.length / 1024).toFixed(0)} kB)`);
