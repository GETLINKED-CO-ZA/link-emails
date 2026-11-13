const DEFAULT_LOGO = 'https://www.getlinked.co.za/link-mark.png';
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

// Attachment limits (keep in sync with the front end).
// Vercel caps request bodies at ~4.5 MB and base64 adds ~33%, so stay small.
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;        // per file (decoded)
const MAX_ATTACHMENTS_TOTAL_BYTES = 3 * 1024 * 1024; // all files (decoded)
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'rtf', 'png', 'jpg', 'jpeg', 'zip'
]);

// Only accept HTTPS images that came from our own upload storage
function validateImageUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      !parsed.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    throw new Error('Invalid image URL');
  }
  return parsed.href;
}

// Validates the attachments array and returns Brevo's format:
// [{ name, content }] where content is base64
function validateAttachments(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('Attachments are invalid.');
  if (input.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`A maximum of ${MAX_ATTACHMENT_COUNT} attachments is allowed.`);
  }

  let total = 0;
  return input.map(item => {
    if (!item || typeof item.filename !== 'string' || typeof item.content !== 'string') {
      throw new Error('An attachment is invalid.');
    }

    // Strip any path and control characters from the filename
    const name = item.filename.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim();
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

    if (!name || name.length > 150 || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`"${name || 'File'}" is not an allowed attachment type.`);
    }

    const content = item.content.replace(/\s/g, '');
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
      throw new Error(`"${name}" could not be read. Please attach it again.`);
    }

    const bytes = Buffer.from(content, 'base64').length;
    if (bytes === 0 || bytes > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${name}" is empty or larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    }

    total += bytes;
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
      throw new Error(`Attachments exceed the ${MAX_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024} MB total limit.`);
    }

    return { name, content };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { subject, body, signatureUrl, logoUrl, recipients, attachments } = req.body || {};

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
  let safeLogo = DEFAULT_LOGO;
  try {
    if (signatureUrl) safeSignature = validateImageUrl(signatureUrl);
    if (logoUrl) safeLogo = validateImageUrl(logoUrl);
  } catch {
    return res.status(400).json({ error: 'Logo or signature image is invalid. Please upload it again.' });
  }

  let safeAttachments = [];
  try {
    safeAttachments = validateAttachments(attachments);
  } catch (error) {
    return res.status(400).json({ error: error.message });
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

  const logo = escapeHTML(safeLogo);

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

          <tr>
            <td align="center" style="background:#7b1c1c;padding:22px 25px 24px;">
              <img src="${logo}" width="66" height="66" alt="LINK"
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
                    <img src="${logo}" width="62" height="62" alt="LINK mark"
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
      const payload = {
        sender: { email: process.env.SENDER_EMAIL, name: process.env.SENDER_NAME },
        to: [{ email }],
        subject: subject.trim(),
        htmlContent,
        textContent: body.trim(),
        tags: ['LINK-Email-Distribution']
      };

      // Brevo expects: attachment: [{ name, content (base64) }]
      if (safeAttachments.length) payload.attachment = safeAttachments;

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': process.env.BREVO_API_KEY
        },
        body: JSON.stringify(payload)
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
