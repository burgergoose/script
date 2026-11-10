'use strict';

// Builds a copy of the website that can be hosted as plain files (GitHub + raw.githack.com).
// The laptop still runs server.js: the hosted page connects back to it for the tunnel.
//
//   node build-static.js --base /USER/REPO/main/ --backend wss://your-address.example
//
// --base     the repo's folder on the host. On raw.githack.com that is /USER/REPO/BRANCH/
// --backend  the public address of the laptop's server (wss://...)
// --out      output folder (default: site) - a plain folder, not expected to be a git
//            working tree; copy its contents into one yourself afterward.
// --mirrors  entry-point folders, either a plain number (e.g. 1000 -> v0001..v1000) or a
//            comma-separated list of names (default: v0001). Each one becomes a tiny
//            index.svg; everything else lives once under shared/ and every mirror points
//            at it. A Service Worker's scope ceiling is set by the directory of the SCRIPT
//            that registers it, not the page that calls .register() - so many different
//            mirror pages can all register the one shared/a/sw.js with the one shared
//            scope, regardless of which mirror the visitor actually opened.
// --engine   (optional) a GitHub-hosted base URL (e.g. a raw.githack.com or jsDelivr link
//            to another repo) that already holds the engine files
//            (controller/core/networking/transport). When set, this build does NOT copy
//            the engine into --out - the page fetches it from --engine at runtime instead.
//            Omit it to build a single self-contained site, same as before.
// --scripts  (optional) a GitHub-hosted base URL for the supporting-library repo (lib.js).
//            When set, lib.js is NOT copied into --out - m.json points at --scripts instead.
//            Omit it to copy lib.js into --out and reference it locally.
//
// Every first-party JS file (ours, not the vendored engine) is run through Terser before
// being written: comments and whitespace stripped, local variable names mangled. Top-level
// names are NOT mangled, on purpose - our files share one implicit global scope across
// separate <script> tags (no module system), so e.g. lib.js's top-level `settings` has to
// keep that exact name for achroma.js, loaded as a different file, to still find it.
//
// Each build gets a new submission_id (a 10-digit number), written to UPDATE_ID in --out
// and printed below. Add it to the link you share as ?submission_id=<id> so you can tell
// which update is live: https://raw.githack.com/.../index.svg?submission_id=<id>#k=<code>

const fs = require('node:fs');
const path = require('node:path');
const { uvPath } = require('@titaniumnetwork-dev/ultraviolet');
const { baremuxPath } = require('@mercuryworkshop/bare-mux/node');
const { minify } = require('terser');

async function obf(code) {
  const result = await minify(code, { compress: true, mangle: true, format: { comments: false } });
  if (result.error) throw result.error;
  return result.code;
}

// Minifies the JS inside one inline <script>...</script> block (the first one found) in an
// HTML/SVG source string, leaving everything else untouched.
async function obfInlineScript(html, open = '<script>', close = '</script>') {
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error(`no ${open}...${close} block found`);
  const codeStart = start + open.length;
  const code = html.slice(codeStart, end);
  const minified = await obf(code);
  return html.slice(0, codeStart) + minified + html.slice(end);
}

async function main() {
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
  const mirrorsArg = args.mirrors || 'v0001';
  let mirrors;
  if (/^\d+$/.test(mirrorsArg)) {
    // A plain number generates that many sequentially-numbered mirrors: v0001, v0002, ...
    const count = Number(mirrorsArg);
    const width = Math.max(4, String(count).length);
    mirrors = Array.from({ length: count }, (_, i) => 'v' + String(i + 1).padStart(width, '0'));
  } else {
    mirrors = mirrorsArg.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const root = __dirname;
  const out = path.resolve(root, args.out || 'site');
  const epoxyPath = path.join(root, 'node_modules', '@mercuryworkshop', 'epoxy-transport', 'dist');

  let engine = args.engine || '';
  if (engine && !engine.endsWith('/')) engine += '/';
  let scripts = args.scripts || '';
  if (scripts && !scripts.endsWith('/')) scripts += '/';

  fs.rmSync(out, { recursive: true, force: true });
  const shared = path.join(out, 'shared');
  const sharedBase = `${base}shared/`;

  // The engine's four parts. Each vendor file goes under one category folder.
  // controller/core = the rewriting engine itself; networking/transport = the socket layer.
  // These are vendored, already-built library bundles - left as they are, not re-minified.
  const ENGINE_FILES = {
    'controller/uv.handler.js': path.join(uvPath, 'uv.handler.js'),
    'controller/uv.client.js': path.join(uvPath, 'uv.client.js'),
    'core/uv.bundle.js': path.join(uvPath, 'uv.bundle.js'),
    'core/uv.sw.js': path.join(uvPath, 'uv.sw.js'),
    'networking/index.js': path.join(epoxyPath, 'index.js'),
    'networking/index.mjs': path.join(epoxyPath, 'index.mjs'),
    'transport/index.js': path.join(baremuxPath, 'index.js'),
    'transport/index.mjs': path.join(baremuxPath, 'index.mjs'),
    'transport/worker.js': path.join(baremuxPath, 'worker.js'),
  };

  const engineBase = engine || sharedBase + 'engine/';
  if (!engine) {
    // Self-contained build: the engine files live in this same output, under shared/engine/.
    for (const [rel, src] of Object.entries(ENGINE_FILES)) {
      const dest = path.join(shared, 'engine', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Everything but the per-mirror index.svg lives once, under shared/.
  fs.cpSync(path.join(root, 'public'), shared, {
    recursive: true,
    filter: (src) => !['locked.html', '404.html', 'index.svg'].includes(path.basename(src)),
  });

  // achroma.js is the main script - core/api.js (networking) and core/inject.js (page
  // injection) stay separate files locally, for easier editing, and are joined here.
  fs.rmSync(path.join(shared, 'core'), { recursive: true, force: true });
  const achromaSrc =
    fs.readFileSync(path.join(root, 'public', 'core', 'api.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'public', 'core', 'inject.js'), 'utf8');
  fs.writeFileSync(path.join(shared, 'achroma.js'), await obf(achromaSrc));

  if (scripts) {
    // lib.js is fetched from the scripts repo at runtime - don't ship our own copy.
    fs.rmSync(path.join(shared, 'lib.js'), { force: true });
  } else {
    // Self-contained: obfuscate the copy that was just cp'd in alongside everything else.
    const libPath = path.join(shared, 'lib.js');
    fs.writeFileSync(libPath, await obf(fs.readFileSync(libPath, 'utf8')));
  }
  const libUrl = scripts ? scripts + 'lib.js' : 'lib.js';

  // sw.js and uv.config.js live under shared/a/ - and since a Service Worker's scope ceiling
  // is set by the directory of the registering SCRIPT, not the calling page, every mirror can
  // register this one shared worker with this one shared scope.
  const uvConfigSrc = `/*global Ultraviolet*/
self.__uv$config = {
  prefix: '${sharedBase}a/service/',
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: '${engineBase}controller/uv.handler.js',
  client: '${engineBase}controller/uv.client.js',
  bundle: '${engineBase}core/uv.bundle.js',
  config: '${sharedBase}a/uv.config.js',
  sw: '${engineBase}core/uv.sw.js',
};
`;
  fs.writeFileSync(path.join(shared, 'a', 'uv.config.js'), await obf(uvConfigSrc));

  // sw.js loads uv.bundle.js itself; point that one import at the engine.
  const swPath = path.join(shared, 'a', 'sw.js');
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const swMarker = "importScripts('/engine/core/uv.bundle.js');";
  if (!swSrc.includes(swMarker)) {
    console.error(`sw.js no longer contains ${JSON.stringify(swMarker)} - fix this script's replace target.`);
    process.exit(1);
  }
  fs.writeFileSync(swPath, await obf(swSrc.replace(swMarker, `importScripts('${engineBase}core/uv.bundle.js');`)));

  // a/worker.js is the same-origin SharedWorker stub; point its one import at the engine too.
  const workerPath = path.join(shared, 'a', 'worker.js');
  const workerSrc = fs.readFileSync(workerPath, 'utf8');
  const workerMarker = "importScripts('/engine/transport/worker.js');";
  if (!workerSrc.includes(workerMarker)) {
    console.error(`a/worker.js no longer contains ${JSON.stringify(workerMarker)} - fix this script's replace target.`);
    process.exit(1);
  }
  fs.writeFileSync(workerPath, await obf(workerSrc.replace(workerMarker, `importScripts('${engineBase}transport/worker.js');`)));

  // shared/index.html's bootstrap script reads this to know what to load, and in what order.
  // Paths here are relative to shared/ (where index.html lives), except the cross-repo ones.
  fs.writeFileSync(path.join(shared, 'm.json'), JSON.stringify({
    load: [
      `${engineBase}core/uv.bundle.js`,
      'a/uv.config.js',
      `${engineBase}transport/index.js`,
      libUrl,
      'config.js',
      'achroma.js',
    ],
  }, null, 2) + '\n');

  // index.html's own inline bootstrap script (fetches account.html + m.json, loads each file).
  const indexHtmlPath = path.join(shared, 'index.html');
  const indexHtmlSrc = fs.readFileSync(indexHtmlPath, 'utf8');
  fs.writeFileSync(indexHtmlPath, await obfInlineScript(indexHtmlSrc));

  // A new id per build, so a shared link can say which update it points at.
  const submissionId = args['submission-id'] || (
    String(1 + Math.floor(Math.random() * 9)) + // first digit 1-9
    Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('')
  );
  const configSrc = `window.V2 = '${submissionId}';\nwindow.V3 = '${engineBase}';\n`;
  fs.writeFileSync(path.join(shared, 'config.js'), await obf(configSrc));
  fs.writeFileSync(path.join(out, 'UPDATE_ID'), submissionId + '\n');

  // Backend selection lives here, not in config.js - dressed up as an ordinary page.
  const accountPath = path.join(shared, 'pages', 'account.html');
  const accountSrc = fs.readFileSync(accountPath, 'utf8');
  const cfgMarker = /<script id="cfg">[\s\S]*?<\/script>/;
  if (!cfgMarker.test(accountSrc)) {
    console.error('pages/account.html has no <script id="cfg"> block - fix this script\'s replace target.');
    process.exit(1);
  }
  const accountWithBackend = accountSrc.replace(cfgMarker,
    `<script id="cfg">\n    window.V1 = '${backend}';\n  </script>`);
  fs.writeFileSync(accountPath, await obfInlineScript(accountWithBackend, '<script id="cfg">', '</script>'));

  // Each mirror is just a thin index.svg pointing at the one shared/index.html.
  const mirrorSvgSrc = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><foreignObject width="100%" height="100%"><html xmlns="http://www.w3.org/1999/xhtml"><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d0f14}iframe{width:100%;height:100%;border:0;display:block}</style></head><body>
<iframe id="f" title="Home" allowfullscreen="true"></iframe>
<script><![CDATA[
  document.getElementById('f').src = '../shared/index.html' + location.hash;
]]></script>
</body></html></foreignObject></svg>
`;
  const mirrorSvg = await obfInlineScript(mirrorSvgSrc, '<script><![CDATA[', ']]></script>');
  for (const mirror of mirrors) {
    fs.mkdirSync(path.join(out, mirror), { recursive: true });
    fs.writeFileSync(path.join(out, mirror, 'index.svg'), mirrorSvg);
  }

  console.log(`Built ${out}`);
  console.log(`  base:         ${base}`);
  console.log(`  mirrors:      ${mirrors.join(', ')}`);
  console.log(`  engine:       ${engine || '(self-contained, under shared/engine/)'}`);
  console.log(`  scripts:      ${scripts || '(self-contained, lib.js included)'}`);
  console.log(`  backend:      ${backend}`);
  console.log(`  submission id: ${submissionId}`);
  console.log(`  add to the shared link: ?submission_id=${submissionId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
