// Bundles the app into ONE self-contained HTML page (inline CSS + classic script) at dist/roomsync.html,
// for hosts that only serve a single file. `node build-artifact.mjs`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const logic = r('js/logic.js');
const names = [...logic.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const L = `const L = (() => {\n${logic.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;
const store = r('js/store.js').replace(/^import .*$/m, '').replace(/^export /gm, '');
const app = r('js/app.js').replace(/^import .*$/gm, '');
const css = r('css/styles.css');
const html = `<title>RoomSync</title>
<style>${css}
:root { color-scheme: light; } body { background: #FFFACD; color: #1B3A32; }</style>
<a class="skip-link" href="#main">Skip to main content</a>
<div id="app"><p class="boot" role="status">Loading RoomSync…</p></div>
<div id="toasts" aria-live="polite" aria-atomic="false"></div>
<dialog id="modal" aria-labelledby="modal-title"></dialog>
<script>
${L}
${store}
${app}
</script>`;
mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/roomsync.html', import.meta.url), html);
console.log('wrote dist/roomsync.html', html.length, 'bytes');
