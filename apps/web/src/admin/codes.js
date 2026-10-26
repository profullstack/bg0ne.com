/**
 * Operator tool for credit codes and invite quotas, against DATABASE_URL.
 *
 * On dev2 it runs inside the app container, which already has the database:
 *
 *   docker exec bg0necom-app-1 bun apps/web/src/admin/codes.js mint --credits 300 --label "for Ada"
 *   ... codes.js list
 *   ... codes.js revoke <code id>
 *   ... codes.js reconcile <user id>        copy any redeemed code missing from credit_ledger
 *   ... codes.js quota <user id> <total>    set someone's invite allowance
 *
 * mint options: --max N (redemptions, default 1), --expires-days N. The code is printed
 * once; only its hash is stored.
 */
import { sql } from '@bg0ne/db';
import { reconcileCodeGrants } from '@bg0ne/db/queries';
import { listCodes, mintCode, revokeCode, setInviteQuota } from '../lib/credits.js';

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2);
      flags[name] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else positional.push(arg);
  }
  return { positional, flags };
}

const HELP = `codes.js mint --credits N [--label TEXT] [--max N] [--expires-days N] [--by NAME]
codes.js list [--json]
codes.js revoke CODE_ID
codes.js reconcile USER_ID
codes.js quota USER_ID TOTAL`;

async function main() {
  const { positional, flags } = parse(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case 'mint': {
      const minted = await mintCode({
        credits: Number(flags.credits),
        label: typeof flags.label === 'string' ? flags.label : '',
        maxRedemptions: flags.max === undefined ? 1 : Number(flags.max),
        expiresInDays: flags['expires-days'] === undefined ? null : Number(flags['expires-days']),
        createdBy: typeof flags.by === 'string' ? flags.by : 'admin',
      });
      if (flags.json) console.log(JSON.stringify(minted));
      else {
        console.log(minted.code);
        console.error(
          `${minted.grant.amount} credits, ${minted.maxRedemptions} redemption(s), id ${minted.id}` +
            `${minted.expiresAt ? `, expires ${new Date(minted.expiresAt).toISOString().slice(0, 10)}` : ''}. Shown once.`,
        );
      }
      return 0;
    }
    case 'list': {
      const codes = await listCodes();
      if (flags.json) console.log(JSON.stringify(codes));
      else
        for (const c of codes)
          console.log(
            `${c.id}  ${String(c.grant.amount).padStart(6)} ${c.grant.unit}  ${c.redemptions}/${c.maxRedemptions}` +
              `${c.revokedAt ? '  revoked' : ''}${c.expiresAt ? `  expires ${new Date(c.expiresAt).toISOString().slice(0, 10)}` : ''}  ${c.label}`,
          );
      return 0;
    }
    case 'revoke':
      if (!rest[0]) throw new Error('revoke CODE_ID');
      await revokeCode(rest[0]);
      console.log(`revoked ${rest[0]}`);
      return 0;
    case 'reconcile':
      if (!rest[0]) throw new Error('reconcile USER_ID');
      console.log(`${await reconcileCodeGrants(rest[0])} grant(s) copied into credit_ledger`);
      return 0;
    case 'quota': {
      const total = Number(rest[1]);
      if (!rest[0] || !Number.isInteger(total) || total < 0) throw new Error('quota USER_ID TOTAL');
      await setInviteQuota(rest[0], total);
      console.log(`${rest[0]} may now make ${total} invites in all`);
      return 0;
    }
    default:
      console.log(HELP);
      return cmd ? 1 : 0;
  }
}

main()
  .then(async (code) => {
    await sql.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err?.message ?? err);
    await sql.end().catch(() => {});
    process.exit(1);
  });
