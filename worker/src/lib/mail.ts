import type { Env } from './env';

export interface MailSender {
  sendOtpEmail(to: string, code: string): Promise<void>;
}

class ResendSender implements MailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async sendOtpEmail(to: string, code: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject: `Your Resident Registry code: ${code}`,
        text: `Your one-time sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.\n\n— The Address Resident Registry`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

class MailChannelsSender implements MailSender {
  constructor(private readonly from: string) {}
  async sendOtpEmail(to: string, code: string): Promise<void> {
    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.from, name: 'The Address Resident Registry' },
        subject: `Your Resident Registry code: ${code}`,
        content: [{ type: 'text/plain', value: `Your one-time sign-in code is ${code}.\n\nIt expires in 10 minutes.` }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`MailChannels ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

class NoopSender implements MailSender {
  async sendOtpEmail(to: string, code: string): Promise<void> {
    console.log(`[NOOP mail] would send code ${code} to ${to}`);
  }
}

export function mailSenderFor(env: Env): MailSender {
  const provider = env.MAIL_PROVIDER || 'noop';
  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    return new ResendSender(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  if (provider === 'mailchannels') return new MailChannelsSender(env.MAIL_FROM);
  return new NoopSender();
}
