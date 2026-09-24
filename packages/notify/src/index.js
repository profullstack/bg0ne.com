import { config } from '@bg0ne/config';

/**
 * Email via Resend over plain fetch. One HTTP call does not justify a dependency,
 * and this way the failure is a status code that can be read and logged.
 */
async function send({ to, subject, text }) {
  if (!config.mail.enabled) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.mail.resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: config.mail.from, to, subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendLoginLink({ email, url }) {
  return send({
    to: email,
    subject: 'Your bg0ne sign-in link',
    text: `Tap to sign in:\n\n${url}\n\nThe link works once and expires in 20 minutes.\nIf you did not ask for it, ignore this email.`,
  });
}

export async function sendTopupReceipt({ email, credits, amountCents }) {
  return send({
    to: email,
    subject: `${credits} bg0ne credits added`,
    text: [
      `Your payment of $${(amountCents / 100).toFixed(2)} settled and ${credits} credits are on your account.`,
      '',
      'Credits do not expire.',
      '',
      `${config.siteUrl}/account`,
    ].join('\n'),
  });
}
