import { beforeEach, expect, test } from 'bun:test';
import { sql } from '../packages/db/src/index.js';
import * as q from '../packages/db/src/queries.js';

/**
 * Shared results.
 *
 * The id is the whole access control: an unguessable uuid is the only thing between
 * a link and somebody's photograph. So the tests care about two things, that a live
 * share is reachable and that a dead one is not reachable by any path.
 */

/*
 * No afterAll(close) here.
 *
 * `sql` is one pool shared by every test file in the process, so a file that closes
 * it in afterAll leaves whichever file runs next talking to a dead handle and
 * failing with ERR_POSTGRES_CONNECTION_CLOSED -- a Postgres error that says nothing
 * about the actual cause, which is another test file's teardown. The pool goes when
 * the process does.
 */

let user;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

beforeEach(async () => {
  await sql`truncate shares, credit_ledger, cutouts, payments, sessions, api_keys, users restart identity cascade`;
  user = await q.findOrCreateUser(`share-${crypto.randomUUID()}@example.com`);
});


async function makeCutout(tier = 'preview') {
  return q.recordCutout({ userId: user.id, tier, model: 'u2net', width: 10, height: 10 });
}

test('a stored share round-trips its bytes', async () => {
  const cutoutId = await makeCutout();
  const share = await q.createShare({
    cutoutId, userId: user.id, png: PNG, width: 10, height: 10, tier: 'preview', model: 'u2net',
  });
  expect(share?.id).toBeTruthy();

  const got = await q.getShare(share.id);
  expect(Buffer.from(got.png).equals(PNG)).toBe(true);
  expect(got.width).toBe(10);
});

test('an anonymous cutout can still be shared', async () => {
  const share = await q.createShare({ cutoutId: null, userId: null, png: PNG, tier: 'preview' });
  expect(share?.id).toBeTruthy();
  expect(await q.getShare(share.id)).toBeTruthy();
});

/**
 * Expiry is enforced in the QUERY, not only by the sweeper, so a purge that fails to
 * run can never serve an image past its date.
 */
test('an expired share is unreachable even before it is purged', async () => {
  const share = await q.createShare({ cutoutId: null, userId: user.id, png: PNG, ttlDays: 7 });
  await sql`update shares set expires_at = now() - interval '1 second' where id = ${share.id}`;

  expect(await q.getShare(share.id)).toBeNull();
  expect(await q.getShareMeta(share.id)).toBeNull();

  // Only now does the sweeper actually remove the bytes.
  expect(await q.purgeExpiredShares()).toBe(1);
});

test('purging removes only what has expired', async () => {
  const live = await q.createShare({ cutoutId: null, userId: user.id, png: PNG, ttlDays: 7 });
  const dead = await q.createShare({ cutoutId: null, userId: user.id, png: PNG, ttlDays: 7 });
  await sql`update shares set expires_at = now() - interval '1 day' where id = ${dead.id}`;

  expect(await q.purgeExpiredShares()).toBe(1);
  expect(await q.getShare(live.id)).toBeTruthy();
});

test('a garbage share id is a miss, not a crash', async () => {
  expect(await q.getShare('not-a-uuid')).toBeNull();
  expect(await q.getShare("'; drop table shares; --")).toBeNull();
  expect(await q.getShareMeta('../../etc/passwd')).toBeNull();
});

test('an oversized image is declined rather than stored', async () => {
  const big = Buffer.alloc(200);
  expect(await q.createShare({ cutoutId: null, userId: user.id, png: big, maxBytes: 100 })).toBeNull();
  // And an empty one is not a share at all.
  expect(await q.createShare({ cutoutId: null, userId: user.id, png: Buffer.alloc(0) })).toBeNull();
});

/**
 * The history is driven from cutouts, so a record survives its image. A history that
 * silently drops its oldest rows is worse than none, because it looks complete.
 */
test('history keeps the row after the image expires', async () => {
  const cutoutId = await makeCutout('hd');
  const share = await q.createShare({ cutoutId, userId: user.id, png: PNG, tier: 'hd' });

  let rows = await q.cutoutHistory(user.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].share_id).toBe(share.id);

  await sql`update shares set expires_at = now() - interval '1 day' where id = ${share.id}`;
  rows = await q.cutoutHistory(user.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].share_id).toBeNull();
  expect(rows[0].tier).toBe('hd');
});

test('history is only ever your own', async () => {
  const other = await q.findOrCreateUser(`other-${crypto.randomUUID()}@example.com`);
  await q.recordCutout({ userId: other.id, tier: 'hd', model: 'u2net' });
  await makeCutout();

  expect(await q.cutoutHistory(user.id)).toHaveLength(1);
  expect(await q.cutoutHistory(other.id)).toHaveLength(1);
});

test('only the owner can delete a share', async () => {
  const other = await q.findOrCreateUser(`other2-${crypto.randomUUID()}@example.com`);
  const share = await q.createShare({ cutoutId: null, userId: user.id, png: PNG });

  expect(await q.deleteShare({ id: share.id, userId: other.id })).toBe(false);
  expect(await q.getShare(share.id)).toBeTruthy();

  expect(await q.deleteShare({ id: share.id, userId: user.id })).toBe(true);
  expect(await q.getShare(share.id)).toBeNull();
});

test('deleting the cutout keeps the share, and deleting the user takes it', async () => {
  const cutoutId = await makeCutout();
  const share = await q.createShare({ cutoutId, userId: user.id, png: PNG });

  await sql`delete from cutouts where id = ${cutoutId}`;
  expect(await q.getShare(share.id)).toBeTruthy();

  await sql`delete from users where id = ${user.id}`;
  expect(await q.getShare(share.id)).toBeNull();
});
