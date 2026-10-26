-- Credit codes and invites (@profullstack/redeem-credits, @profullstack/affiliates).
--
-- bg0ne already keeps a balance: credit_ledger, in credits (one per full-resolution
-- cutout). A redeemed code
-- or an invite bonus is one more row in THAT ledger, never a second balance beside it.
-- The packages keep only their own bookkeeping (which codes exist, as hashes; who
-- redeemed what; who invited whom).

-- Where a grant came from, for grants that are not a payment: 'code:<id>' for a credit
-- code, 'invite:<id>' for an invite bonus. The unique index makes each one pay out once
-- per account, so a retried request or a re-run reconcile is free.
alter table credit_ledger add column if not exists source text;
create unique index if not exists credit_ledger_one_grant_per_source
  on credit_ledger (user_id, source) where source is not null;

-- @profullstack/redeem-credits' tables, from its schemaSql('pg', 'redeem_'). The
-- default prefix is credit_, and credit_ledger is already ours: the prefix is what
-- keeps the package from mistaking our ledger for its own.
create table if not exists redeem_codes (
  id text primary key,
  hash text not null unique,
  label text not null,
  unit text not null,
  amount double precision not null,
  recur text,
  months integer,
  max_redemptions integer not null,
  redemptions integer not null default 0,
  expires_at bigint,
  created_at bigint not null,
  revoked_at bigint,
  created_by text
);

create table if not exists redeem_redemptions (
  code_id text not null,
  user_id text not null,
  at bigint not null,
  primary key (code_id, user_id)
);

create table if not exists redeem_ledger (
  id bigserial primary key,
  user_id text not null,
  unit text not null,
  amount double precision not null,
  kind text not null,
  recur text,
  months integer,
  source text not null,
  at bigint not null
);
create index if not exists redeem_ledger_user_unit on redeem_ledger (user_id, unit, at);

create table if not exists redeem_accounts (
  user_id text not null,
  unit text not null,
  version integer not null default 0,
  primary key (user_id, unit)
);

-- An invite or a ?ref= code rides on the emailed link, the way the signup profile does:
-- the account does not exist until the link is spent, and the link is often opened in
-- another browser (a phone's mail app) that never saw the invite cookie.
alter table login_tokens add column if not exists invite_code text;
alter table login_tokens add column if not exists ref_code text;

-- One row per person per accepted invite: whether the bonus was paid and, if not, why.
-- Claimed before the credits are written, so a retried sign-in never pays twice.
create table if not exists invite_bonuses (
  invite_id  text not null,
  user_id    uuid not null references users (id) on delete cascade,
  role       text not null check (role in ('inviter', 'invitee')),
  credits    integer not null default 0,
  status     text not null,
  created_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);
create index if not exists invite_bonuses_user_idx on invite_bonuses (user_id, created_at desc);
