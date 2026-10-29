/**
 * Server-rendered HTML as template strings.
 *
 * No JSX and no client framework: the whole app is one upload form and a canvas, and
 * a build step for that is a cost with nothing on the other side of it.
 */

import { config as siteConfig } from '@bg0ne/config';
import {
  COLUMNS as PROFILE_COLUMNS,
  PROFILE_ENHANCE_SCRIPT,
  renderProfileFields,
} from '@profullstack/profile';
import { pfsFooter } from '../lib/pfs-footer.js';
import { pitFooter } from '../lib/pit-footer.js';

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
select{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--fg)}
.muted{color:var(--mut)}
.big{font-size:38px;font-weight:700;letter-spacing:-.02em}
/* The checkerboard is what makes transparency legible; without it a cutout on a
   light page looks like it simply deleted the subject. */
.checker{background-image:linear-gradient(45deg,#c8c8d4 25%,transparent 25%),linear-gradient(-45deg,#c8c8d4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c8c8d4 75%),linear-gradient(-45deg,transparent 75%,#c8c8d4 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0}
/* The site footer is the shared @profullstack/footer (links, << Profullstack >> ring,
   copyright), laid out as one wrapping row. The header's bare nav rule
   (margin-left:auto, 15px) would push its navs right. */
footer.pfs-footer{margin-top:80px;--pfs-footer-muted:var(--mut);border-top-color:var(--line)}
footer.pfs-footer nav{margin-left:0;font-size:inherit}
footer.pfs-footer .pfs-footer__inner{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:6px 18px}
.cp-ad{height:0;overflow:hidden}
.cp-ad[data-cp-filled]{height:auto;overflow:visible;min-height:40px;margin-top:10px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:24px 0 24px}
.tab{padding:9px 14px;text-decoration:none;color:var(--mut);border-bottom:2px solid transparent;margin-bottom:-1px}
.tab:hover{color:var(--fg)}
.tab.on{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
.histgrid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.hist{padding:12px}
.thumb{width:100%;height:150px;object-fit:contain;border-radius:8px;display:block}
.thumb.expired{display:flex;align-items:center;justify-content:center;border:1px dashed var(--line);color:var(--mut);font-size:14px}
.histmeta{display:flex;flex-direction:column;gap:2px;margin-top:10px;font-size:14px}
.sharebox{display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap}
.ba{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.ba figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.ba img{width:100%;height:320px;object-fit:contain;border-radius:9px;display:block}
.ba figcaption{margin-top:10px;font-size:14px;font-weight:600}
/* The shared profile fields (@profullstack/profile renderProfileFields), made to read
   like the email box above them. */
.pfs-profile{border:0;padding:0;margin:0;min-width:0}
.pfs-profile__row label{display:block;color:var(--mut)}
.pfs-profile__row input{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--fg);width:100%;margin:8px 0 14px}
.pfs-profile__optional{font-size:14px}
.pfs-profile__error{color:#c33;font-size:14px;margin:-8px 0 14px}
.btn.coinpay{display:flex;justify-content:center;align-items:center;gap:8px;width:100%;max-width:420px;margin:0 0 10px}
.or{display:flex;align-items:center;gap:12px;max-width:420px;color:var(--mut);font-size:14px;margin:6px 0 16px}
.or::before,.or::after{content:"";flex:1;border-top:1px solid var(--line)}
.sharebox input{font:inherit;font-size:14px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);flex:1;min-width:240px}
`;

/**
 * One CrawlProof ad unit (slot below, manage at https://crawlproof.com/ads/slots).
 * text_link is the fluid format, so it fits the 900px column and a phone alike and
 * carries its own "Sponsored" mark. It sits at the top of the content, never against
 * the footer. Only public inner pages opt in via page({ ad: true }); the
 * homepage, account, keys, history and sign-in never carry it. Zero height until ad.js marks
 * it data-cp-filled, so an unsold or blocked slot leaves no hole.
 */
export const AD_SLOT = '8baac674-5682-428d-99c6-2a326d6e847e';
const AD_UNIT = `<aside class="wrap cp-ad" data-cp-ad data-slot="${AD_SLOT}" data-format="text_link"></aside>
<script src="https://crawlproof.com/ad.js" async></script>`;

function page({ title, description, body, canonical, ad = false }) {
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
<script data-site="68d4a3fa-7b29-4939-b0cd-ab3289bad021" src="https://crawlproof.com/stats.js" async></script>
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
${ad ? AD_UNIT : ''}
<main class="wrap">${body}</main>
${pfsFooter()}
${pitFooter()}
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
unlimited. Full resolution costs ${config.pricing.hdCents}&cent; an image, paid in any major coin or
PayPal, with no subscription and no expiring credits. The whole thing is MIT licensed, so you can
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
  <div id="sharebox" class="sharebox" style="display:none">
    <input id="shareurl" readonly onclick="this.select()">
    <button id="copy" class="btn ghost">Copy link</button>
    <a id="open" class="btn ghost" target="_blank" rel="noopener">Open</a>
    <span id="shareexp" class="muted"></span>
  </div>
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

    // Every cutout gets a link, free or paid. It is the cheapest advertising here.
    const shareUrl=res.headers.get('x-share-url');
    const box=document.getElementById('sharebox');
    if(shareUrl){
      document.getElementById('shareurl').value=shareUrl;
      document.getElementById('open').href=shareUrl;
      const exp=res.headers.get('x-share-expires');
      document.getElementById('shareexp').textContent = exp
        ? 'expires '+new Date(exp).toISOString().slice(0,10) : '';
      box.style.display='';
    } else { box.style.display='none'; }

    status.textContent='';
    result.style.display='';
  }catch(err){status.textContent='Failed: '+err.message}
}

document.getElementById('copy').addEventListener('click',async()=>{
  const btn=document.getElementById('copy');
  try{await navigator.clipboard.writeText(document.getElementById('shareurl').value);btn.textContent='Copied'}
  catch{document.getElementById('shareurl').select();btn.textContent='Press Ctrl+C'}
  setTimeout(()=>{btn.textContent='Copy link'},1500);
});
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
        <td class="muted">$${(t.cents / t.credits / 100).toFixed(4)} each</td>
        <td><button class="btn" data-cents="${t.cents}">Buy</button></td>
      </tr>`,
    )
    .join('');

  return page({
    ad: true,
    title: 'Pricing - bg0ne',
    description: 'Pay by the image. Credits never expire and there is no subscription.',
    canonical: `${config.siteUrl}/pricing`,
    body: `
<h1>Pay by the image</h1>
<p class="lede">One credit is one full-resolution cutout. Credits never expire, there is
nothing to cancel, and previews stay free whether you have credits or not.</p>

<div class="card">
<p class="muted" style="margin:0 0 14px">Pay with any major coin or PayPal. You pick on the
CoinPay checkout page.</p>
<table>
<tr><th>Top up</th><th>Credits</th><th>Per image</th><th></th></tr>
${rows}
</table>
<p id="buyerr" class="muted" style="margin:14px 0 0"></p>
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
const err=document.getElementById('buyerr');
document.querySelectorAll('button[data-cents]').forEach(b=>b.addEventListener('click',async()=>{
  const was=b.textContent;
  b.disabled=true;b.textContent='Starting…';err.textContent='';
  try{
    const body=new FormData();
    body.append('cents',b.dataset.cents);
    const res=await fetch('/api/topup',{method:'POST',body});
    if(res.status===401){location.href='/signin';return}
    const j=await res.json().catch(()=>({}));
    if(j.checkout_url){location.href=j.checkout_url;return}
    // Say what happened. A button that silently does nothing is the bug this replaces.
    err.textContent=(j.error||'could not start checkout')+(j.detail?' - '+j.detail:'');
  }catch(e){
    err.textContent='could not start checkout: '+e.message;
  }finally{
    b.disabled=false;b.textContent=was;
  }
}));
</script>`,
  });
}

/* -------------------------------------------------------------------- docs -- */

export function Docs({ config }) {
  const base = config.siteUrl;
  return page({
    ad: true,
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

/** One tab bar, so the three account pages cannot drift apart. */
function AccountNav(active) {
  const tabs = [
    ['/account', 'Credits'],
    ['/account/history', 'History'],
    ['/account/keys', 'API keys'],
    ['/invites', 'Invites'],
  ];
  return `<nav class="tabs">${tabs
    .map(
      ([href, label]) =>
        `<a href="${href}" class="${href === active ? 'tab on' : 'tab'}">${label}</a>`,
    )
    .join('')}</nav>`;
}

const PLACEHOLDER_SUFFIX = '@coinpay.invalid';

/** What the account is called: its email, or for a CoinPay-only account, that fact. */
function accountLabel(user, coinpay) {
  if (!String(user.email).toLowerCase().endsWith(PLACEHOLDER_SUFFIX)) return user.email;
  const who = coinpay?.identity?.name || coinpay?.identity?.email;
  return who ? `Signed in with CoinPay (${who})` : 'Signed in with CoinPay';
}

const COINPAY_STATUS = {
  linked: 'CoinPay connected. You can sign in with it from now on.',
  disconnected: 'CoinPay disconnected.',
  only_way_in:
    'CoinPay is the only way in to this account, so it cannot be disconnected. Add a passkey first.',
};

function CoinpaySection({ enabled, identity, canDisconnect, status }) {
  const note = status && COINPAY_STATUS[status];
  return `
<h2 id="coinpay">CoinPay</h2>
${note ? `<p class="card"${status === 'only_way_in' ? ' style="border-color:#c33"' : ''}>${esc(note)}</p>` : ''}
<div class="card" style="max-width:420px">
${
  identity
    ? `<p style="margin:0 0 12px">Connected${identity.email ? ` as ${esc(identity.email)}` : ''}. Sign in with CoinPay opens this account.</p>
  ${
    canDisconnect
      ? `<form method="post" action="/account/coinpay/disconnect" style="margin:0"><button class="btn ghost" type="submit">Disconnect CoinPay</button></form>`
      : '<p class="muted" style="margin:0;font-size:14px">CoinPay is the only way in to this account, so it cannot be disconnected.</p>'
  }`
    : enabled
      ? `<p style="margin:0 0 12px">Connect your CoinPay account to sign in here with it.</p>
  <a class="btn" href="/api/v1/coinpay/oauth/start?mode=link" rel="nofollow">Connect CoinPay</a>`
      : '<p class="muted" style="margin:0">Not connected.</p>'
}
</div>`;
}

export function Account({
  user,
  balance,
  ledger,
  config,
  contact,
  contactError,
  contactSaved,
  redeemError = null,
  redeemed = 0,
  invited = 0,
  coinpay = null,
}) {
  const rows = ledger
    .map(
      (h) =>
        `<tr><td>${h.delta > 0 ? '+' : ''}${h.delta}</td><td>${esc(h.reason)}</td>
         <td class="muted">${new Date(h.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>`,
    )
    .join('');
  return page({
    title: 'Account - bg0ne',
    description: 'Your credits and billing history.',
    body: `
<h1>Account</h1>
<p class="lede">${esc(accountLabel(user, coinpay))}</p>
${AccountNav('/account')}
${invited ? `<p class="card">Welcome. Your invite added ${invited.toLocaleString()} credits, and the friend who invited you got the same.</p>` : ''}

<div class="card">
  <div class="muted">Credits</div>
  <div class="big">${balance.toLocaleString()}</div>
  <p class="muted" style="margin:4px 0 0">One credit, one full-resolution image. They do not expire.</p>
  <p style="margin:14px 0 0"><a class="btn" href="/pricing">Top up</a></p>
</div>

<h2 id="code">Have a code?</h2>
${redeemed ? `<p class="muted">Code redeemed: ${redeemed.toLocaleString()} credits added.</p>` : ''}
${redeemError ? `<p class="card" style="border-color:#c33">${esc(redeemError)}</p>` : ''}
<form method="post" action="/account/redeem" class="card" style="max-width:420px">
  <label for="code" class="muted">Credit code</label>
  <input id="code" name="code" type="text" required maxlength="48" autocomplete="off" spellcheck="false" placeholder="BG-XXXX-XXXX-XXXX-XXXX" style="margin:8px 0 14px">
  <button class="btn" type="submit">Redeem</button>
  <p class="muted" style="margin:12px 0 0;font-size:14px">The credits land on this account and never expire. Want to bring someone? <a href="/invites">You have invites</a>.</p>
</form>

<h2>Credit history</h2>
<div class="card">
${ledger.length ? `<table><tr><th>Change</th><th>Reason</th><th>When</th></tr>${rows}</table>` : '<p class="muted" style="margin:0">Nothing yet.</p>'}
</div>

<h2 id="contact">Contact details</h2>
<p class="muted">Private to your account. Sent with ${esc(contact?.email ?? user.email)}.</p>
${contactError ? `<p class="card" style="border-color:#c33">${esc(contactError)}</p>` : ''}
${contactSaved ? '<p class="muted">Contact details saved.</p>' : ''}
<form method="post" action="/account/contact" class="card" style="max-width:420px">
  ${renderProfileFields({ fields: SIGNUP_FIELDS, values: contact ?? {} })}
  <button class="btn" type="submit">Save contact details</button>
</form>

${coinpay?.enabled || coinpay?.identity ? CoinpaySection(coinpay) : ''}

<p style="margin-top:32px"><form method="post" action="/auth/signout"><button class="btn ghost">Sign out</button></form></p>`,
  });
}

/**
 * Everything this account has run.
 *
 * A row survives its image. When a result has expired the entry stays and says so,
 * because a history that silently drops its oldest entries is worse than none: it
 * looks complete.
 */
export function History({ user, rows, config }) {
  const cards = rows
    .map((r) => {
      const when = new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ');
      const dims = r.width && r.height ? `${r.width}&times;${r.height}` : '';
      const body = r.share_id
        ? `<a href="/c/${r.share_id}"><img class="checker thumb" src="/c/${r.share_id}/image.png" alt="cutout" loading="lazy"></a>`
        : '<div class="thumb expired"><span>image expired</span></div>';
      return `<div class="card hist">
        ${body}
        <div class="histmeta">
          <strong>${r.tier === 'hd' ? 'Full resolution' : 'Preview'}</strong>
          <span class="muted">${dims}</span>
          <span class="muted">${esc(r.model ?? '')}</span>
          <span class="muted">${when}</span>
          ${r.share_id ? `<a href="/c/${r.share_id}">Share link</a>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return page({
    title: 'History - bg0ne',
    description: 'Every cutout on this account.',
    body: `
<h1>History</h1>
<p class="lede">${esc(user.email)}</p>
${AccountNav('/account/history')}

${
  rows.length
    ? `<p class="muted">Images are kept for ${config.shares.ttlDays} days. The record of a
       cutout stays after its image has gone.</p>
       <div class="histgrid">${cards}</div>`
    : '<div class="card"><p class="muted" style="margin:0">Nothing yet. <a href="/">Run one</a>.</p></div>'
}`,
  });
}

export function Keys({ user, keys, config }) {
  const keyRows = keys
    .map(
      (k) =>
        `<tr><td><code>${esc(k.prefix)}&hellip;</code></td><td class="muted">${esc(k.name)}</td>
         <td class="muted">${k.last_used_at ? new Date(k.last_used_at).toISOString().slice(0, 10) : 'never used'}</td></tr>`,
    )
    .join('');
  return page({
    title: 'API keys - bg0ne',
    description: 'Keys for calling the API from your own code.',
    body: `
<h1>API keys</h1>
<p class="lede">${esc(user.email)}</p>
${AccountNav('/account/keys')}

<div class="card">
  ${keys.length ? `<table><tr><th>Key</th><th>Name</th><th>Last used</th></tr>${keyRows}</table>` : '<p class="muted" style="margin:0">No keys yet.</p>'}
  <p style="margin:14px 0 0"><button id="mint" class="btn ghost">Create a key</button></p>
  <p id="minted" class="muted" style="margin:10px 0 0"></p>
</div>

<p class="muted">A key spends credits the same way the website does. See the
<a href="/docs">API docs</a>.</p>

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

/* ------------------------------------------------------------------ sharing -- */

/**
 * What to say when there is no "before".
 *
 * Never guesses. This page used to tell every sourceless share that its original
 * had been too large, which was false for everything made before originals were
 * kept at all, and pointed the reader at a size limit that had nothing to do with
 * it. A reason we did not record is a reason we do not state.
 */
function noBeforeReason(share) {
  if (share.source_omitted_reason === 'too_large') {
    return 'The original was too large to keep, so only the result was saved.';
  }
  if (share.source_omitted_reason === 'legacy') {
    return 'This one was made before originals were kept, so only the result was saved. Run the image again to get a before and after.';
  }
  return 'Only the result was saved for this one.';
}

export function SharePage({ share, config }) {
  const expires = new Date(share.expires_at);
  const days = Math.max(0, Math.ceil((expires - Date.now()) / 86_400_000));
  const url = `${config.siteUrl}/c/${share.id}`;
  const outDims = share.width && share.height ? `${share.width}&times;${share.height}` : '';
  const srcDims =
    share.source_width && share.source_height
      ? `${share.source_width}&times;${share.source_height}`
      : '';

  /*
   * Before and after, side by side.
   *
   * The "before" is what makes a shared cutout legible to somebody who never saw the
   * original -- on its own, a subject on a checkerboard is just a picture. It is
   * missing only when the upload was too large to keep, in which case the page shows
   * the result alone rather than an apology.
   */
  const pair = share.has_source
    ? `<div class="ba">
         <figure>
           <img src="/c/${share.id}/original" alt="before">
           <figcaption>Before${srcDims ? ` <span class="muted">${srcDims}</span>` : ''}</figcaption>
         </figure>
         <figure>
           <img class="checker" src="/c/${share.id}/image.png" alt="after">
           <figcaption>After${outDims ? ` <span class="muted">${outDims}</span>` : ''}</figcaption>
         </figure>
       </div>`
    : `<div class="card" style="text-align:center">
         <img class="checker" src="/c/${share.id}/image.png" alt="cutout"
              style="max-width:100%;border-radius:10px">
         <p class="muted" style="margin:10px 0 0">${esc(noBeforeReason(share))}</p>
       </div>`;

  return page({
    ad: true,
    title: 'A cutout - bg0ne',
    description: 'A background removed with bg0ne.',
    // No canonical and no indexing: the id is the only thing protecting the images.
    body: `
<h1>Before and after</h1>
<p class="lede">Background removed with <a href="/">bg0ne</a>. This link works for
${days} more day${days === 1 ? '' : 's'}.</p>

${pair}

<p style="margin-top:18px">
  <a class="btn" href="/c/${share.id}/image.png" download="cutout.png">Download PNG</a>
  <button class="btn ghost" id="copy" data-url="${esc(url)}">Copy link</button>
  <span class="muted" style="margin-left:10px">${esc(share.model ?? '')}</span>
</p>

<div class="card" style="margin-top:32px">
  <strong>Made with bg0ne</strong>
  <p class="muted" style="margin:6px 0 12px">Open source background removal. Previews are
  free and unlimited, full resolution is ${config.pricing.hdCents}&cent; an image, and you
  can run the whole thing yourself.</p>
  <a class="btn" href="/">Try it on your own image</a>
</div>

<script>
document.getElementById('copy').addEventListener('click',async(e)=>{
  try{await navigator.clipboard.writeText(e.target.dataset.url);e.target.textContent='Copied'}
  catch{e.target.textContent='Copy failed'}
  setTimeout(()=>{e.target.textContent='Copy link'},1500);
});
</script>`,
  });
}

export function Gone({ config }) {
  return page({
    title: 'Link expired - bg0ne',
    description: 'That shared cutout has expired.',
    body: `
<h1>That link has expired</h1>
<p class="lede">Shared results are kept for ${config.shares.ttlDays} days and then
deleted. That is deliberate: they are your images, not ours.</p>
<p><a class="btn" href="/">Make a new one</a></p>`,
  });
}

/* -------------------------------------------------------------------- auth -- */

/*
 * The rest of the shared profile, asked for in signup mode only. Email is this form's
 * own box, so the package renders the other five. A plain sign-in never sees or needs
 * them: the same link still makes an account for an address it has not seen.
 */
const SIGNUP_FIELDS = PROFILE_COLUMNS.filter((f) => f !== 'email');

export function SignIn({ error, mode, values, errors, invite = null, bonus = 0 }) {
  const signup = mode === 'signup';
  return page({
    title: signup ? 'Create your account — bg0ne' : 'Sign in — bg0ne',
    description: signup
      ? 'Create a bg0ne account with an emailed link.'
      : 'Sign in with an emailed link.',
    body: `
<h1>${invite ? 'You were invited' : signup ? 'Create your account' : 'Sign in'}</h1>
${invite ? `<p class="card">Someone wanted you on bg0ne.${bonus > 0 ? ` Make your account with this link and you both get <strong>${bonus}</strong> free full-resolution cutouts.` : ''}</p>` : ''}
<p class="lede">We email you a link. There is no password to choose, forget or leak, and
the same link makes the account if you do not have one yet.</p>
${error ? `<p class="card" style="border-color:#c33">${esc(error)}</p>` : ''}
${
  siteConfig.coinpayOauth.enabled
    ? `<a class="btn coinpay" href="/api/v1/coinpay/oauth/start" rel="nofollow">Sign in with CoinPay</a>
<div class="or">or with your email</div>`
    : ''
}
<form method="post" action="/auth/link" class="card" style="max-width:420px">
  ${signup ? '<input type="hidden" name="mode" value="signup">' : ''}
  ${invite ? `<input type="hidden" name="invite" value="${esc(invite)}">` : ''}
  <label for="email" class="muted">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" style="margin:8px 0 14px"${values?.email ? ` value="${esc(values.email)}"` : ''}>
  ${errors?.email ? `<p class="pfs-profile__error" role="alert">${esc(errors.email)}</p>` : ''}
  ${signup ? renderProfileFields({ fields: SIGNUP_FIELDS, values, errors }) : ''}
  <button class="btn" type="submit">Email me a link</button>
</form>
<p class="muted">${signup ? 'Already have an account? <a href="/signin">Sign in</a>' : 'New here? <a href="/signup">Create an account</a>'}</p>
${signup ? `<script>${PROFILE_ENHANCE_SCRIPT}</script>` : ''}`,
  });
}

export function Invites({ user, summary, created = null, error = null }) {
  const { quota, invites, bonus_credits: bonus } = summary;
  const now = new Date().toISOString();
  const rows = invites
    .map((i) => {
      const state = i.used
        ? 'joined'
        : i.revoked
          ? 'withdrawn'
          : i.expires_at && i.expires_at < now
            ? 'expired'
            : 'waiting';
      return `<tr><td>${esc(i.note) || '<span class="muted">no note</span>'}</td><td class="muted">${state}</td>
        <td class="muted">${esc(String(i.created_at).slice(0, 10))}</td></tr>`;
    })
    .join('');
  return page({
    title: 'Invites - bg0ne',
    description: 'Invite someone to bg0ne. You both get credits.',
    body: `
<h1>Invites</h1>
<p class="lede">${esc(user.email)}</p>
${AccountNav('/invites')}
${error ? `<p class="card" style="border-color:#c33">${esc(error)}</p>` : ''}
${
  created
    ? `<div class="card"><strong>Your invite link</strong>, shown once. Send it to one person:
  <pre style="margin:10px 0 0;white-space:pre-wrap;word-break:break-all">${esc(created.url)}</pre></div>`
    : ''
}
<div class="card">
  <p style="margin:0 0 12px">You have <strong>${quota.left}</strong> of ${quota.total} invites left. Each link works once, for 30 days.${bonus > 0 ? ` When someone makes an account through it, you each get <strong>${bonus}</strong> credits.` : ''}</p>
  ${
    quota.left > 0
      ? `<form method="post" action="/invites" style="margin:0;display:flex;gap:8px;flex-wrap:wrap">
    <input type="text" name="note" maxlength="120" placeholder="Who is it for? (only you see this)" style="flex:1;min-width:200px">
    <button class="btn" type="submit">Make an invite link</button>
  </form>`
      : '<p class="muted" style="margin:0">All used. Invites are scarce on purpose.</p>'
  }
</div>
${invites.length ? `<h2>Sent</h2><div class="card"><table><tr><th>For</th><th>State</th><th>Made</th></tr>${rows}</table></div>` : ''}
<h2>Your link</h2>
<div class="card">
  <p class="muted" style="margin:0 0 10px">Open and unlimited: anyone who signs up after following it is credited to you.</p>
  <pre style="margin:0;white-space:pre-wrap;word-break:break-all">${esc(summary.affiliate_url)}</pre>
  ${summary.joined ? `<p class="muted" style="margin:10px 0 0">${summary.joined} ${summary.joined === 1 ? 'person has' : 'people have'} joined on your invites.</p>` : ''}
</div>`,
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
