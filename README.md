# bg0ne

**BG, gone.** Background removal that runs on open models, self-hosts in one
container, and bills by the image instead of by the month.

Live at [bg0ne.com](https://bg0ne.com). MIT licensed.

## What it is

Background removal is a solved problem with excellent open models behind it, and it
is still mostly sold as a subscription with credits that expire. bg0ne is the same
capability with the pricing turned back into what it actually is: a few cents of
compute.

* **Free previews.** Capped by pixels, not by a counter. No account, no card. A
  visitor can find out whether it works on their photo without meeting a signup wall.
* **3 cents a full-resolution image.** Credits never expire. Nothing to cancel.
* **Agents pay per call.** `POST /api/cutout` answers `402` with an x402 offer and
  settles in USDC. No account, no key, no card.
* **Or run it yourself.** `docker compose up`. Leave the payment variables unset and
  it is simply a free private instance.

## Models

Every model this ships is permissively licensed, because the hosted service is billed
for and a non-commercial model would poison that.

| Model | License | Role |
|---|---|---|
| `u2net` | Apache-2.0 | preview tier, baked into the image |
| `isnet-general-use` | Apache-2.0 | paid tier, baked into the image |
| `birefnet-general` | MIT | best quality, ~1GB, fetched on demand |
| `birefnet-portrait` | MIT | portraits, fetched on demand |

BRIA's RMBG-2.0 is the obvious better-known choice and is **deliberately absent**: its
weights are CC BY-NC 4.0 and commercial use requires a paid agreement with BRIA.

BiRefNet is the best of these and wants a GPU to be worth the wait, so the default
paid model is ISNet until there is one. Set `INFER_HD_MODEL=birefnet-general` to
switch.

## Run it

```bash
git clone https://github.com/profullstack/bg0ne.com
cd bg0ne.com
docker compose up
```

That is the whole setup. The app migrates its own database on boot.

Without Docker you need Bun 1.3+, Python 3.12+ and a Postgres:

```bash
bun install
pip install -r infer/requirements.txt
DATABASE_URL=postgres://localhost/bg0ne bun run dev
```

## Architecture

One image, two runtimes, talking over loopback.

```
browser / agent
      |
      v
  Bun + Hono  ......  Postgres (accounts, credit ledger, payments)
      |
      v  127.0.0.1:7001
  Python + rembg (ONNX)
```

The model is a separate process because every good open background-removal model is
Python and ships as ONNX, and the web app is Bun. `INFER_URL` is what makes that a
deployment decision rather than an architectural one: point it at a GPU box and
nothing else changes.

### Why the credit ledger is a ledger

`credit_ledger` is append-only and the balance is its sum. A single `balance` column
is one bad `UPDATE` away from being wrong forever with no way to find out when it went
wrong, and these are bought with real money, so people ask where they went.

Two consequences worth knowing before editing that code:

* A spend happens **before** the work, and takes `select ... for update` on the user
  row. Without the lock, twenty concurrent cutouts all read the same balance, all pass
  the check, and the account finishes negative having been given work nobody paid for.
  There is a test for exactly this.
* Because the spend comes first, a failed cutout has to be **refunded explicitly**.
  The refund is a fresh positive row rather than a deleted one: the ledger records
  what happened, and what happened is that somebody was charged and then made whole.

Credit grants are idempotent per payment, enforced by a unique index rather than by
remembering. CoinPay retries a webhook until it is acknowledged, so "we already
granted this" has to be a database constraint.

## Environment

| Variable | Required | |
|---|---|---|
| `DATABASE_URL` | yes | the only hard requirement |
| `SITE_URL` | yes in prod | passkey rpID derives from it |
| `ROLES` | no | `web,infer` by default |
| `INFER_URL` | no | loopback by default; a remote URL stops the local model spawning |
| `INFER_HD_MODEL` | no | `isnet-general-use` |
| `RESEND_API_KEY` | no | without it, sign-in links are logged instead of sent |
| `COINPAY_API_KEY` | no | `cp_live_`/`cp_test_`; without it payments are off |
| `COINPAY_BUSINESS_ID` | no | |
| `COINPAY_WEBHOOK_SECRET` | no | |
| `COINPAY_X402_KEY` | no | a **scoped** key, not the merchant key above |
| `X402_PAY_TO` | no | the EVM address agent payments land in |

Secrets belong in the vault and reach the container as platform variables. There is
deliberately no `.env` loading in this app.

## Tests

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bg0ne -p 55433:5432 postgres:16-alpine
DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/bg0ne bun test
```

## License

MIT. The models carry their own licenses, listed above.
