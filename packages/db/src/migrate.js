import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './index.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Forward-only migrations, keyed by filename and applied inside one transaction each.
 *
 * There is no `down`. A rollback of a schema change that has already accepted writes
 * is a data-loss decision, and encoding it as a routine step invites someone to take
 * it casually at 3am; the recovery path is a new forward migration.
 *
 * Called on boot by whichever process starts first, so a deploy needs no manual step.
 * The advisory lock makes that safe when web and worker boot concurrently.
 */
export async function migrate({ log = console.log } = {}) {
  await sql`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  // 8675309 is arbitrary but must be stable: two processes racing to migrate would
  // otherwise both see an unapplied file and both try to create the same table.
  await sql`select pg_advisory_lock(8675309)`;
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Set(
      (await sql`select filename from schema_migrations`).map((r) => r.filename),
    );

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      log(`[migrate] applying ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations ${tx({ filename: file })}`;
      });
      ran++;
    }
    log(ran === 0 ? '[migrate] up to date' : `[migrate] applied ${ran} migration(s)`);
    return ran;
  } finally {
    await sql`select pg_advisory_unlock(8675309)`;
  }
}
