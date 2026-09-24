/**
 * Server-rendered HTML as template strings.
 *
 * No JSX and no client framework: the whole app is one upload form and a canvas, and
 * a build step for that is a cost with nothing on the other side of it.
 */

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfbfd;--fg:#14141a;--mut:#6b6b78;--line:#e4e4ec;--card:#fff;--accent:#5b4bff;--accent-fg:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#0d0d12;--fg:#f0f0f5;--mut:#9a9aab;--line:#24242e;--card:#15151d;--accent:#8c7dff;--accent-fg:#0d0d12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:900px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:20px;height:64px}
.brand{font-weight:700;font-size:20px;text-decoration:none;color:var(--fg);letter-spacing:-.02em}
.brand span{color:var(--accent)}
nav{margin-left:auto;display:flex;gap:18px;font-size:15px}
nav a{text-decoration:none;color:var(--mut)}nav a:hover{color:var(--fg)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-.03em;margin:48px 0 12px}
h2{font-size:22px;letter-spacing:-.02em;margin:40px 0 12px}
.lede{font-size:19px;color:var(--mut);margin:0 0 32px;max-width:60ch}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.drop{border:2px dashed var(--line);border-radius:14px;padding:48px 20px;text-align:center;cursor:pointer;transition:.15s;background:var(--card)}
.drop:hover,.drop.over{border-color:var(--accent);background:color-mix(in oklab,var(--accent) 6%,var(--card))}
.drop p{margin:6px 0;color:var(--mut)}
.btn{display:inline-block;background:var(--accent);color:var(--accent-fg);border:0;border-radius:9px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:500}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto;font-size:13.5px}
code{font-size:13.5px}
input[type=email]{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--fg);width:100%}
.muted{color:var(--mut)}
.big{font-size:38px;font-weight:700;letter-spacing:-.02em}
/* The checkerboard is what makes transparency legible; without it a cutout on a
   light page looks like it simply deleted the subject. */
.checker{background-image:linear-gradient(45deg,#c8c8d4 25%,transparent 25%),linear-gradient(-45deg,#c8c8d4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c8c8d4 75%),linear-gradient(-45deg,transparent 75%,#c8c8d4 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0}
footer{margin:80px 0 40px;padding-top:24px;border-top:1px solid var(--line);color:var(--mut);font-size:14px}
`;

function page({ title, description, body, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✂️</text></svg>">
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/">bg<span>0</span>ne</a>
  <nav>
    <a href="/pricing">Pricing</a>
    <a href="/docs">API</a>
    <a href="https://github.com/profullstack/bg0ne.com">Source</a>
    <a href="/account">Account</a>
  </nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="wrap">
  <p>Open source, MIT. Runs on open models you can host yourself.
  Pay by the image in USDC, or run it on your own box for nothing.</p>
  <p><a href="https://profullstack.com">Profullstack</a></p>
</footer>
</body></html>`;
}

/* ----------------------------------------------------------------- landing -- */

export function Landing({ config }) {
  return page({
    title: 'bg0ne — BG, gone',
    description:
      'Remove image backgrounds with open models. Free previews, pay by the image for full resolution, or self-host the whole thing.',
    canonical: `${config.siteUrl}/`,
    body: `
<h1>BG, gone.</h1>
<p class="lede">Drop an image, get it back without its background. Previews are free and
unlimited. Full resolution costs ${config.pricing.hdCents}&cent; an image, paid in USDC,
with no subscription and no expiring credits. The whole thing is MIT licensed, so you can
also just run it yourself.</p>

<div id="drop" class="drop">
  <p><strong>Drop an image here</strong></p>
  <p>or click to choose &middot; PNG, JPEG, WebP</p>
  <input id="file" type="file" accept="image/*" hidden>
</div>

<div id="status" class="muted" style="margin:16px 0;min-height:24px"></div>

<div id="result" style="display:none">
  <div class="grid">
    <div><h2 style="margin-top:0">Before</h2><img id="before" style="max-width:100%;border-radius:10px"></div>
    <div><h2 style="margin-top:0">After</h2><img id="after" class="checker" style="max-width:100%;border-radius:10px"></div>
  </div>
  <p style="margin-top:16px">
    <a id="dl" class="btn" download="cutout.png">Download PNG</a>
    <span id="tier" class="muted" style="margin-left:12px"></span>
  </p>
</div>

<h2>Why this exists</h2>
<p class="muted">Background removal is a solved problem with excellent open models behind
it, and it is still mostly sold as a subscription with credits that expire. This is the
same capability with the pricing turned back into what it is: a few cents of compute.</p>

<div class="grid" style="margin-top:24px">
  <div class="card"><strong>Free previews</strong><p class="muted" style="margin:6px 0 0">
  Capped at ${config.pricing.previewMaxEdge}px on the long edge. No account, no card.</p></div>
  <div class="card"><strong>${config.pricing.hdCents}&cent; full resolution</strong><p class="muted" style="margin:6px 0 0">
  Credits never expire. No subscription to cancel.</p></div>
  <div class="card"><strong>Agents pay per call</strong><p class="muted" style="margin:6px 0 0">
  x402 on the API. No signup, no key, just a paid request.</p></div>
  <div class="card"><strong>Self-host it</strong><p class="muted" style="margin:6px 0 0">
  MIT, open weights, one container. <a href="/docs">Docs</a>.</p></div>
</div>

<script>
const drop=document.getElementById('drop'),input=document.getElementById('file'),
      status=document.getElementById('status'),result=document.getElementById('result'),
      before=document.getElementById('before'),after=document.getElementById('after'),
      dl=document.getElementById('dl'),tierEl=document.getElementById('tier');

drop.addEventListener('click',()=>input.click());
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');
  if(e.dataTransfer.files[0])go(e.dataTransfer.files[0])});
input.addEventListener('change',()=>{if(input.files[0])go(input.files[0])});

async function go(file){
  if(!file.type.startsWith('image/')){status.textContent='That is not an image.';return}
  before.src=URL.createObjectURL(file);
  status.textContent='Working…';
  result.style.display='none';
  const body=new FormData();
  body.append('file',file);
  body.append('tier','auto');
  try{
    const res=await fetch('/api/cutout',{method:'POST',body});
    if(!res.ok){
      // 402 is the interesting failure: it means it worked and costs money.
      const j=await res.json().catch(()=>({}));
      status.innerHTML = res.status===402
        ? 'Out of credits. <a href="/pricing">Top up</a> to keep going at full resolution.'
        : 'Failed: '+(j.error||res.status);
      return;
    }
    const blob=await res.blob();
    after.src=URL.createObjectURL(blob);
    dl.href=after.src;
    const tier=res.headers.get('x-cutout-tier'), ms=res.headers.get('x-cutout-ms');
    tierEl.textContent=(tier==='hd'?'Full resolution':'Preview')+' · '+ms+'ms · '+res.headers.get('x-cutout-model');
    status.textContent='';
    result.style.display='';
  }catch(err){status.textContent='Failed: '+err.message}
}
</script>`,
  });
}

/* ----------------------------------------------------------------- pricing -- */

export function Pricing({ config }) {
  const rows = config.pricing.topups
    .map(
      (t) => `<tr>
        <td><strong>$${(t.cents / 100).toFixed(2)}</strong></td>
        <td>${t.credits.toLocaleString()} images</td>
        <td class="muted">$${((t.cents / t.credits) / 100).toFixed(4)} each</td>
        <td><button class="btn" data-cents="${t.cents}">Buy</button></td>
      </tr>`,
    )
    .join('');
  return page({
    title: 'Pricing — bg0ne',
    description: 'Pay by the image. Credits never expire and there is no subscription.',
    canonical: `${config.siteUrl}/pricing`,
    body: `
<h1>Pay by the image</h1>
<p class="lede">One credit is one full-resolution cutout. Credits never expire, there is
nothing to cancel, and previews stay free whether you have credits or not.</p>

<div class="card">
<table>
<tr><th>Top up</th><th>Credits</th><th>Per image</th><th></th></tr>
${rows}
</table>
</div>

<h2>Agents</h2>
<p class="muted">An agent does not need any of the above. <code>POST /api/cutout</code>
answers <code>402</code> with an x402 offer and settles in USDC per call, so there is no
account, no key and no card. See the <a href="/docs">API docs</a>.</p>

<h2>Or pay nothing</h2>
<p class="muted">The repository is MIT and the models are permissively licensed
(BiRefNet is MIT, U&#8209;2&#8209;Net is Apache&#8209;2.0). One container runs the whole
thing. We are selling the convenience, not the capability.</p>

<script>
document.querySelectorAll('button[data-cents]').forEach(b=>b.addEventListener('click',async()=>{
  const body=new FormData();body.append('cents',b.dataset.cents);
  const res=await fetch('/api/topup',{method:'POST',body});
  if(res.status===401){location.href='/signin';return}
  const j=await res.json();
  if(j.checkout_url)location.href=j.checkout_url;
  else alert(j.error||'could not start checkout');
}));
</script>`,
  });
}

/* -------------------------------------------------------------------- docs -- */

export function Docs({ config }) {
  const base = config.siteUrl;
  return page({
    title: 'API — bg0ne',
    description: 'One endpoint. Pay with credits, an API key, or x402 per call.',
    canonical: `${base}/docs`,
    body: `
<h1>API</h1>
<p class="lede">One endpoint, three ways to pay for it.</p>

<h2>Free preview</h2>
<pre><code>curl -F file=@photo.jpg ${base}/api/cutout &gt; cutout.png</code></pre>
<p class="muted">No account. Capped at ${config.pricing.previewMaxEdge}px on the long edge
and rate limited; over the limit you get a 402 with an offer rather than a 429.</p>

<h2>Full resolution, with a key</h2>
<pre><code>curl -H "authorization: Bearer bg_live_…" \\
     -F file=@photo.jpg -F tier=hd \\
     ${base}/api/cutout &gt; cutout.png</code></pre>
<p class="muted">Spends one credit. <code>x-credits-remaining</code> comes back on every
response. With no credits left you get <code>402</code> and the top-up URL, never a
silently downgraded image.</p>

<h2>Full resolution, as an agent</h2>
<pre><code>coinpay x402 pay ${base}/api/cutout
curl -H "x-crawl-pass: $PASS" -F file=@photo.jpg -F tier=hd ${base}/api/cutout</code></pre>
<p class="muted">No account and no key. The 402 carries the offer, CoinPay settles it
straight to the merchant, and the pass covers ${config.x402.passMinutes} minutes.</p>

<h2>Response headers</h2>
<table class="card">
<tr><th>Header</th><th>Meaning</th></tr>
<tr><td><code>x-cutout-tier</code></td><td><code>preview</code> or <code>hd</code></td></tr>
<tr><td><code>x-cutout-model</code></td><td>which model answered</td></tr>
<tr><td><code>x-cutout-ms</code></td><td>end to end milliseconds</td></tr>
<tr><td><code>x-credits-remaining</code></td><td>after this call, when credits were spent</td></tr>
</table>

<h2>Self-hosting</h2>
<pre><code>git clone https://github.com/profullstack/bg0ne.com
cd bg0ne.com &amp;&amp; docker compose up</code></pre>
<p class="muted">Set <code>DATABASE_URL</code> and you have the whole thing. Leave the
CoinPay variables unset and payments are simply off, which is the right configuration
for a private instance.</p>`,
  });
}

/* ----------------------------------------------------------------- account -- */

export function Account({ user, balance, history, keys, recent, config }) {
  const rows = history
    .map(
      (h) =>
        `<tr><td>${h.delta > 0 ? '+' : ''}${h.delta}</td><td>${esc(h.reason)}</td>
         <td class="muted">${new Date(h.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>`,
    )
    .join('');
  const keyRows = keys
    .map((k) => `<tr><td><code>${esc(k.prefix)}…</code></td><td class="muted">${esc(k.name)}</td></tr>`)
    .join('');
  return page({
    title: 'Account — bg0ne',
    description: 'Your credits, keys and recent cutouts.',
    body: `
<h1>Account</h1>
<p class="lede">${esc(user.email)}</p>

<div class="grid">
  <div class="card">
    <div class="muted">Credits</div>
    <div class="big">${balance.toLocaleString()}</div>
    <p class="muted" style="margin:4px 0 0">One credit, one full-resolution image. They do not expire.</p>
    <p style="margin:14px 0 0"><a class="btn" href="/pricing">Top up</a></p>
  </div>
  <div class="card">
    <div class="muted">Recent cutouts</div>
    <div class="big">${recent.length}</div>
    <p class="muted" style="margin:4px 0 0">Last ${recent.length} shown in your history.</p>
  </div>
</div>

<h2>API keys</h2>
<div class="card">
  ${keys.length ? `<table>${keyRows}</table>` : '<p class="muted" style="margin:0">No keys yet.</p>'}
  <p style="margin:14px 0 0"><button id="mint" class="btn ghost">Create a key</button></p>
  <p id="minted" class="muted" style="margin:10px 0 0"></p>
</div>

<h2>Credit history</h2>
<div class="card">
${history.length ? `<table><tr><th>Change</th><th>Reason</th><th>When</th></tr>${rows}</table>` : '<p class="muted" style="margin:0">Nothing yet.</p>'}
</div>

<p style="margin-top:32px"><form method="post" action="/auth/signout"><button class="btn ghost">Sign out</button></form></p>

<script>
document.getElementById('mint').addEventListener('click',async()=>{
  const res=await fetch('/account/keys',{method:'POST'});
  const j=await res.json();
  document.getElementById('minted').innerHTML = j.key
    ? 'Copy this now, it is not shown again: <code>'+j.key+'</code>'
    : (j.error||'failed');
});
</script>`,
  });
}

/* -------------------------------------------------------------------- auth -- */

export function SignIn({ error }) {
  return page({
    title: 'Sign in — bg0ne',
    description: 'Sign in with an emailed link.',
    body: `
<h1>Sign in</h1>
<p class="lede">We email you a link. There is no password to choose, forget or leak, and
the same link makes the account if you do not have one yet.</p>
${error ? `<p class="card" style="border-color:#c33">${esc(error)}</p>` : ''}
<form method="post" action="/auth/link" class="card" style="max-width:420px">
  <label for="email" class="muted">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" style="margin:8px 0 14px">
  <button class="btn" type="submit">Email me a link</button>
</form>`,
  });
}

export function Sent({ email }) {
  return page({
    title: 'Check your email — bg0ne',
    description: 'A sign-in link is on its way.',
    body: `
<h1>Check your email</h1>
<p class="lede">If ${esc(email)} can receive mail, a sign-in link is on its way. It works
once and expires in 20 minutes.</p>
<p><a href="/">Back to the tool</a></p>`,
  });
}

export function NotFound() {
  return page({
    title: 'Not found — bg0ne',
    description: 'No such page.',
    body: '<h1>Not found</h1><p class="lede">No such page.</p><p><a href="/">Back to the tool</a></p>',
  });
}
