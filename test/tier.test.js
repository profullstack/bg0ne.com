import { expect, test } from 'bun:test';
import { decideTier } from '../apps/web/src/lib/tier.js';

/**
 * The billing decision, which is the one place a mistake either gives work away or
 * charges for something the caller did not get.
 */

test('an explicit preview is always a preview, even for someone who could pay', () => {
  expect(decideTier({ asked: 'preview', paidAgent: true, hasUser: true, canSpend: true })).toEqual({
    tier: 'preview',
    refuse: null,
  });
});

test('an agent holding a pass gets full resolution with no account', () => {
  const d = decideTier({ asked: 'hd', paidAgent: true, hasUser: false, canSpend: false });
  expect(d.tier).toBe('hd');
  expect(d.refuse).toBeNull();
});

test('an account with credit gets full resolution', () => {
  const d = decideTier({ asked: 'auto', paidAgent: false, hasUser: true, canSpend: true });
  expect(d.tier).toBe('hd');
  expect(d.refuse).toBeNull();
});

/**
 * The regression this file exists for.
 *
 * An anonymous caller asking for `tier=hd` used to be handed a 640px preview with a
 * 200 and no indication anything had been substituted. It must be a 402.
 */
test('an anonymous caller asking for hd is refused, not quietly downgraded', () => {
  const d = decideTier({ asked: 'hd', paidAgent: false, hasUser: false, canSpend: false });
  expect(d.refuse).not.toBeNull();
  expect(d.refuse.reason).toMatch(/credits|payment/);
});

test('an account out of credit asking for hd is refused', () => {
  const d = decideTier({ asked: 'hd', paidAgent: false, hasUser: true, canSpend: false });
  expect(d.refuse).not.toBeNull();
  expect(d.refuse.reason).toBe('no credits');
});

/**
 * `auto` is a browser saying "whatever I am entitled to", so a preview is the correct
 * answer rather than an error. Only an EXPLICIT hd is refused.
 */
test('auto falls back to a preview without refusing', () => {
  for (const [hasUser, canSpend] of [
    [false, false],
    [true, false],
  ]) {
    const d = decideTier({ asked: 'auto', paidAgent: false, hasUser, canSpend });
    expect(d.tier).toBe('preview');
    expect(d.refuse).toBeNull();
  }
});

test('no combination ever returns hd without someone having paid for it', () => {
  for (const asked of ['preview', 'hd', 'auto']) {
    for (const paidAgent of [true, false]) {
      for (const hasUser of [true, false]) {
        for (const canSpend of [true, false]) {
          const d = decideTier({ asked, paidAgent, hasUser, canSpend });
          if (d.tier === 'hd') {
            expect(paidAgent || (hasUser && canSpend)).toBe(true);
          }
        }
      }
    }
  }
});
