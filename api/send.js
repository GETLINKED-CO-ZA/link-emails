export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { subject, body, signatureUrl, recipients } = req.body || {};

  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL || !process.env.SENDER_NAME) {
    return res.status(500).json({ error: 'Email server configuration is incomplete.' });
  }

  if (typeof subject !== 'string' || typeof body !== 'string' ||
      !subject.trim() || !body.trim()) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  if (subject.length > 180 || body.length > 30000) {
    return res.status(400).json({ error: 'Subject or message exceeds the allowed length.' });
  }

  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 200) {
    return res.status(400).json({ error: 'Provide between 1 and 200 recipients per batch.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanRecipients = [...new Set(
    recipients.filter(email => typeof email === 'string')
      .map(email => email.trim().toLowerCase())
  )];

  if (cleanRecipients.length !== recipients.length ||
      cleanRecipients.some(email => !emailRegex.test(email))) {
    return res.status(400).json({
      error: 'The recipient list contains invalid or duplicate addresses.'
    });
  }

  let safeSignature = '';
  if (signatureUrl) {
    try {
      const parsed = new URL(signatureUrl);
      if (parsed.protocol !== 'https:' || !parsed.hostname ||
          parsed.username || parsed.password) {
        throw new Error('Invalid signature URL');
      }
      safeSignature = parsed.href;
    } catch {
      return res.status(400).json({
        error: 'Signature must be a valid HTTPS image URL.'
      });
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  const safeSubject = escapeHTML(subject.trim());
  const paragraphs = escapeHTML(body.trim())
    .split(/\n{2,}/)
    .map(paragraph => `
      <p style="margin:0 0 18px;line-height:1.9;color:#49433d;font-size:15px;">
        ${paragraph.replace(/\n/g, '<br>')}
      </p>
    `).join('');

  const signature = safeSignature ? `
    <img src="${escapeHTML(safeSignature)}" alt="Signature"
      style="display:block;max-width:240px;max-height:110px;height:auto;margin-top:22px;">
  ` : '';

  const logoUrl = 'https://www.getlinked.co.za/link-mark.png';

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#f8f6f1;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#f8f6f1;padding:35px 12px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;background:#ffffff;">

          <!-- CENTRED LOGO ON BURGUNDY HEADER -->
          <tr>
            <td align="center" style="background:#7b1c1c;padding:22px 25px 24px;">
              <img src="${logoUrl}" width="66" height="66" alt="LINK"
                style="display:block;width:66px;height:66px;max-width:66px;border:0;margin:0 auto 15px;">
              <div style="height:1px;line-height:1px;background:#b99a55;width:52px;margin:0 auto 13px;">&nbsp;</div>
              <div style="font-size:9px;letter-spacing:3px;color:#e7d8b6;">
                CONNECTION • OPPORTUNITY • GROWTH
              </div>
            </td>
          </tr>

          <tr><td style="padding:38px 35px 12px;">
            <div style="width:42px;height:2px;background:#b99a55;"></div>
            <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:25px;
              line-height:1.4;color:#7b1c1c;margin:25px 0;">${safeSubject}</h1>
          </td></tr>

          <tr><td style="padding:0 35px 35px;">
            ${paragraphs}
            ${signature}
          </td></tr>

          <!-- CONTACT DETAILS LEFT, LOGO AT FAR RIGHT -->
          <tr>
            <td style="padding:25px 30px;background:#f8f6f1;border-top:1px solid #e9e4dc;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="font-size:11px;color:#756e65;line-height:1.9;">
                    <div style="font-family:Georgia,serif;font-size:17px;letter-spacing:3px;
                      color:#7b1c1c;margin-bottom:8px;">LINK</div>
                    <strong style="font-weight:normal;color:#7b1c1c;">SECURE. SAFE. SWIFT.</strong><br>
                    <a href="mailto:office@getlinked.co.za" style="color:#7b1c1c;text-decoration:none;">
                      office@getlinked.co.za</a><br>
                    <a href="https://www.getlinked.co.za" style="color:#7b1c1c;text-decoration:none;">
                      www.getlinked.co.za</a><br>
                    +27 74 571 8332
                  </td>
                  <td width="88" align="right" valign="middle" style="padding-left:12px;">
                    <img src="${logoUrl}" width="62" height="62" alt="LINK mark"
                      style="display:block;width:62px;height:62px;max-width:62px;border:0;margin-left:auto;">
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="font-size:9px;color:#aaa197;letter-spacing:1px;padding-top:17px;">
                    CONNECT. GROW. MOVE FORWARD.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;

  const results = [];
  for (const email of cleanRecipients) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': process.env.BREVO_API_KEY
        },
        body: JSON.stringify({
          sender: { email: process.env.SENDER_EMAIL, name: process.env.SENDER_NAME },
          to: [{ email }],
          subject: subject.trim(),
          htmlContent,
          textContent: body.trim(),
          tags: ['LINK-Email-Distribution']
        })
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        results.push({ email, status: 'sent', messageId: data.messageId || null });
      } else {
        results.push({
          email, status: 'failed',
          error: data.message || data.code || 'Brevo rejected the email.'
        });
      }
    } catch (error) {
      results.push({ email, status: 'failed', error: error.message });
    }
  }

  const successful = results.filter(result => result.status === 'sent').length;
  return res.status(200).json({
    total: results.length,
    successful,
    failed: results.length - successful,
    results
  });
}
