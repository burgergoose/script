'use strict';

// Builds a copy of the website that can be hosted as plain files (GitHub + raw.githack.com).
// The laptop still runs server.js: the hosted page connects back to it for the tunnel.
//
//   node build-static.js --base /USER/REPO/main/ --backend wss://your-address.example
//
// --base     the folder the page lives in on the host. On raw.githack.com that is /USER/REPO/BRANCH/
// --backend  the public address of the laptop's server (wss://...)
// --out      output folder (default: site)
// --engine   (optional) a GitHub-hosted base URL (e.g. a raw.githack.com link to another repo)
//            that already holds the engine files. When set, this build does NOT copy the engine
//            into --out - the page fetches it from --engine at runtime instead. Omit it to build
//            a single self-contained site, same as before.
//
// Each build gets a new submission_id (a 10-digit number), written to UPDATE_ID in --out
// and printed below. Add it to the link you share as ?submission_id=<id> so you can tell
// which update is live: https://raw.githack.com/.../index.svg?submission_id=<id>#k=<code>

const fs = require('node:fs');
const path = require('node:path');
const { uvPath } = require('@titaniumnetwork-dev/ultraviolet');
const { baremuxPath } = require('@mercuryworkshop/bare-mux/node');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

let base = args.base || '/';
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';
const backend = args.backend || '';
if (!/^wss?:\/\/[^/]+$/.test(backend)) {
  console.error('Missing or invalid --backend (expected something like wss://your-address.example)');
  process.exit(1);
}

const root = __dirname;
const out = path.resolve(root, args.out || 'site');
const epoxyPath = path.join(root, 'node_modules', '@mercuryworkshop', 'epoxy-transport', 'dist');
const skipMaps = (src) => !src.endsWith('.map') && !src.endsWith('.d.ts');

let engine = args.engine || '';
if (engine && !engine.endsWith('/')) engine += '/';

fs.rmSync(out, { recursive: true, force: true });
if (!engine) {
  // Self-contained build: the engine files live in this same output.
  fs.cpSync(uvPath, path.join(out, 'a'), { recursive: true, filter: skipMaps });
  fs.cpSync(baremuxPath, path.join(out, 'c'), { recursive: true, filter: skipMaps });
  fs.cpSync(epoxyPath, path.join(out, 'b'), { recursive: true, filter: skipMaps });
}
// Our own files last so they replace the stock sw.js.
fs.cpSync(path.join(root, 'public'), out, {
  recursive: true,
  filter: (src) => !['locked.html', '404.html'].includes(path.basename(src)),
});

// sw.js is always served from this repo's own a/ folder (a Service Worker's scope can never
// reach outside the directory of the script that registered it), so prefix stays under base+'a/'
// even when the engine's other files (uv.bundle.js etc.) are fetched from elsewhere.
const a = engine ? engine + 'a/' : base + 'a/';
fs.writeFileSync(path.join(out, 'a', 'uv.config.js'), `/*global Ultraviolet*/
self.__uv$config = {
  prefix: '${base}a/service/',
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: '${a}uv.handler.js',
  client: '${a}uv.client.js',
  bundle: '${a}uv.bundle.js',
  config: '${base}a/uv.config.js',
  sw: '${a}uv.sw.js',
};
`);
if (engine) {
  // sw.js loads uv.bundle.js itself; point that one import at the engine too.
  const swPath = path.join(out, 'a', 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8').replace("importScripts('uv.bundle.js');", `importScripts('${a}uv.bundle.js');`);
  fs.writeFileSync(swPath, sw);
  // index.html loads uv.bundle.js and the transport library's entry script directly too.
  const htmlPath = path.join(out, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    .replace('src="a/uv.bundle.js"', `src="${a}uv.bundle.js"`)
    .replace('src="c/index.js"', `src="${engine}c/index.js"`);
  fs.writeFileSync(htmlPath, html);
}

// A new id per build, so a shared link can say which update it points at.
const submissionId = args['submission-id'] || (
  String(1 + Math.floor(Math.random() * 9)) + // first digit 1-9
  Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('')
);
fs.writeFileSync(path.join(out, 'config.js'),
  `window.V1 = '${backend}';\nwindow.V2 = '${submissionId}';\nwindow.V3 = '${engine}';\n`);
fs.writeFileSync(path.join(out, 'UPDATE_ID'), submissionId + '\n');

console.log(`Built ${out}`);
console.log(`  base:         ${base}`);
console.log(`  engine:       ${engine || '(self-contained)'}`);
console.log(`  backend:      ${backend}`);
console.log(`  submission id: ${submissionId}`);
console.log(`  add to the shared link: ?submission_id=${submissionId}`);
