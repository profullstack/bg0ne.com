import { beforeAll, beforeEach, expect, test } from 'bun:test';
import * as auth from '../../../packages/auth/src/index.js';
import { sql } from '../../../packages/db/src/index.js';

/**
 * The shared @profullstack/profile fields on signup: asked for in signup mode only,
 * carried on the magic-link token (the account does not exist until the link is
 * spent), and saved into user_profiles on verify.
 *
 * Lives in apps/web because that is the workspace @profullstack/profile installs into.
 * No afterAll(close): the pool is shared by every test file in the process.
 */

let app;

beforeAll(async () => {
  ({ app } = await import('../src/app.js'));
});

beforeEach(async () => {
  await sql`truncate user_profiles, login_tokens, sessions, users restart identity cascade`;
});

const form = (fields) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return { method: 'POST', body };
};

test('signup asks for the profile fields, sign-in does not', async () => {
  const signup = await (await app.request('/signup')).text();
  for (const name of ['first_name', 'last_name', 'company_domain', 'job_title', 'linkedin_url']) {
    expect(signup).toContain(`name="${name}"`);
  }
  expect(signup).toContain('name="mode" value="signup"');
  // One email box, the form's own.
  expect(signup.match(/<input[^>]*name="email"/g)?.length).toBe(1);

  const signin = await (await app.request('/signin')).text();
  expect(signin).not.toContain('name="first_name"');
  expect(signin).not.toContain('name="mode"');
  expect(signin).toContain('href="/signup"');
});

test('a signup without a last name is refused before any link exists', async () => {
  const res = await app.request(
    '/auth/link',
    form({ mode: 'signup', email: 'ada@acme.com', first_name: 'Ada' }),
  );
  expect(res.status).toBe(400);
  const html = await res.text();
  expect(html).toContain('value="Ada"');
  expect(html).toContain('pfs-profile__error');
  const [{ n }] = await sql`select count(*)::int as n from login_tokens`;
  expect(n).toBe(0);
});

test('plain sign-in is never asked for the fields', async () => {
  const res = await app.request('/auth/link', form({ email: 'old@acme.com' }));
  expect(res.status).toBe(200);
  const [row] = await sql`select profile from login_tokens where email = 'old@acme.com'`;
  expect(row.profile).toBeNull();
});

test('signup fields ride the token and are saved when the link is spent', async () => {
  const res = await app.request(
    '/auth/link',
    form({
      mode: 'signup',
      email: 'Ada@Acme.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_domain: 'https://www.acme.com/about',
      job_title: 'VP Engineering',
      linkedin_url: 'in/ada-lovelace',
    }),
  );
  expect(res.status).toBe(200);
  const [token] = await sql`select profile from login_tokens where email = 'ada@acme.com'`;
  expect(token.profile).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace' });

  // The route's link went to the mailer; mint one the same way to spend it here.
  const check = token.profile;
  const url = await auth.createLoginLink('ada@acme.com', { profile: check });
  const spent = await app.request(new URL(url).pathname + new URL(url).search);
  expect(spent.status).toBe(302);

  const [profile] = await sql`
    select p.* from user_profiles p join users u on u.id = p.user_id
    where u.email = 'ada@acme.com'
  `;
  expect(profile).toMatchObject({
    email: 'ada@acme.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    company_domain: 'acme.com',
    job_title: 'VP Engineering',
    linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
  });
  // Handed out once: the token no longer holds the fields.
  const [after] = await sql`select count(*)::int as n from login_tokens where profile is not null`;
  expect(after.n).toBe(1); // only the route's unspent token
});

test('the profile API answers 401 without a session', async () => {
  const res = await app.request('/api/v1/me/profile');
  expect(res.status).toBe(401);
});
