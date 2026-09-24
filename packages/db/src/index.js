import { config } from '@bg0ne/config';
import { SQL } from 'bun';

/**
 * One pool per process. Bun's native Postgres client rather than `pg`, so the
 * container ships one JS runtime and no native addons.
 */
export const sql = new SQL({
  url: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 12),
  idleTimeout: 30,
  connectionTimeout: 15,
  // Railway's Postgres proxy terminates TLS but presents a cert for its own host.
  tls: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

export async function healthcheck() {
  const [row] = await sql`select 1 as ok`;
  return row?.ok === 1;
}

export async function close() {
  await sql.end();
}
