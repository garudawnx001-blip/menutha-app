import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { gzipSync } from 'zlib';

const dir = '/home/user/menutha/apps/web/dist-hosted/assets';
const js = readFileSync(dir + '/' + readdirSync(dir).find((f) => f.endsWith('.js')), 'utf8');

const S = '<' + 'script';
const E = '</' + 'script>';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#FAF6EF" />
<meta name="description" content="Scan the QR at your table, browse the live menu, and order — no app, no sign-up." />
<title>Menutha — Order at your table</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23FAF6EF'/%3E%3Ctext x='50' y='68' font-size='52' text-anchor='middle' font-family='Georgia,serif' fill='%231B5E3F'%3Em%3C/text%3E%3C/svg%3E" />
${S} crossorigin src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js">${E}
${S} crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js">${E}
${S} crossorigin src="https://cdn.jsdelivr.net/npm/@remix-run/router@1.19.2/dist/router.umd.min.js">${E}
${S} crossorigin src="https://cdn.jsdelivr.net/npm/react-router@6.26.2/dist/umd/react-router.production.min.js">${E}
${S} crossorigin src="https://cdn.jsdelivr.net/npm/react-router-dom@6.26.2/dist/umd/react-router-dom.production.min.js">${E}
${S} crossorigin src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">${E}
</head>
<body>
<div id="root"></div>
${S}>${js.replaceAll('</script', '<\\/script')}${E}
</body>
</html>`;

const gz = gzipSync(Buffer.from(html), { level: 9 });
const b64 = gz.toString('base64');
const fn =
  'const GZ = ' + JSON.stringify(b64) + ';\n' +
  'const bytes = Uint8Array.from(atob(GZ), (c) => c.charCodeAt(0));\n' +
  'Deno.serve(() => new Response(bytes.slice(), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip", "Cache-Control": "public, max-age=60" } }));\n';

writeFileSync('/tmp/claude-0/-home-user-menutha/d99897a8-d9fc-5ac1-bf20-1a1c2269d01e/scratchpad/edge-order-small.ts', fn);
writeFileSync('/tmp/claude-0/-home-user-menutha/d99897a8-d9fc-5ac1-bf20-1a1c2269d01e/scratchpad/hosted-test.html', html);
console.log('html', html.length, '→ gz', gz.length, '→ fn source', fn.length);
