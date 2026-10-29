-- Sign in with CoinPay.
--
-- An account is bound to the CoinPay `sub`, never to the email CoinPay reports: that
-- address is unverified (CoinPay's email_verified is always false), so matching on it
-- would hand any existing account to whoever typed its address into a CoinPay signup.
-- One CoinPay identity per account and one account per identity.
create table if not exists coinpay_identities (
  sub           text primary key,
  user_id       uuid not null unique references users(id) on delete cascade,
  -- Contact information only. Never compared against users.email.
  email         text,
  name          text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- The pending authorization request: PKCE verifier and nonce stay on the server,
-- keyed by the state, and are spent exactly once by the callback. A link request
-- also records which signed-in account asked, so the callback can refuse to attach
-- the identity to anybody else. A ?ref= code rides along; an invite code does not
-- (invite bonuses are paid only to accounts made by an emailed link, which proves a
-- real mailbox; a CoinPay address is unverified).
create table if not exists coinpay_oauth_pending (
  state       text primary key,
  verifier    text not null,
  nonce       text not null,
  mode        text not null check (mode in ('signin', 'link')),
  user_id     uuid references users(id) on delete cascade,
  ref_code    text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists coinpay_oauth_pending_expires_idx on coinpay_oauth_pending (expires_at);
