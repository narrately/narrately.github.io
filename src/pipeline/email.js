import nodemailer from 'nodemailer';

export function buildTransport(config) {
  const smtp = config.email?.smtp ?? {};
  if (!smtp.host) throw new Error('No SMTP host configured. Run `narrately onboard` to set up email.');

  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port ?? 587),
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

export async function verifyEmail(config) {
  const transport = buildTransport(config);
  await transport.verify();
  return true;
}

export async function sendReportEmail(config, { markdown, html, subject }) {
  const email = config.email ?? {};
  if (!email.enabled) return { ok: false, error: 'Email delivery is disabled.' };
  if (!email.to) return { ok: false, error: 'No recipient configured.' };

  const transport = buildTransport(config);
  const fromAddress = email.from ?? email.smtp?.user ?? email.to;
  const from = /<.+>/.test(fromAddress) ? fromAddress : `Narrately <${fromAddress}>`;

  const info = await transport.sendMail({
    from,
    to: email.to,
    subject,
    text: markdown,
    html,
  });

  return { ok: true, messageId: info.messageId, accepted: info.accepted };
}
