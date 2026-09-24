-- ---------------------------------------------------------------------------
-- Shareable results.
--
-- A separate table from `cutouts` on purpose. A cutout row is the billing audit
-- trail and is kept forever; the image is somebody's photo and is not. Keeping the
-- bytes in their own table means expiring them is a delete that cannot take the
-- record of what was charged with it.
--
-- The id IS the capability. It is a v4 uuid and the only thing protecting the
-- image, so it must never be sequential and must never be derived from anything
-- guessable like the user or the time.
-- ---------------------------------------------------------------------------

create table shares (
  id           uuid primary key default gen_random_uuid(),
  -- Null once the cutout row is gone; the share can outlive nothing but itself.
  cutout_id    uuid references cutouts(id) on delete set null,
  -- Null for an anonymous preview, which is most of them.
  user_id      uuid references users(id) on delete cascade,
  png          bytea not null,
  content_type text not null default 'image/png',
  width        int,
  height       int,
  tier         text,
  model        text,
  created_at   timestamptz not null default now(),
  -- Not nullable and with no default: an image that never expires is a decision
  -- somebody has to make on purpose, not one they can forget to make.
  expires_at   timestamptz not null
);
create index shares_expires_idx on shares (expires_at);
create index shares_user_idx on shares (user_id, created_at desc);
