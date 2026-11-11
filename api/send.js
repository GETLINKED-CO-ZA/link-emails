
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  const {
    subject,
    body,
    signatureUrl,
    recipients
  } = req.body || {};

  // Validate server configuration
  if (!process.env.BREVO_API_KEY ||
      !process.env.SENDER_EMAIL ||
      !process.env.SENDER_NAME) {
    return res.status(500).json({
      error: 'Email server configuration is incomplete.'
    });
  }

  // Validate message
  if (
    typeof subject !== 'string' ||
    typeof body !== 'string' ||
    !subject.trim() ||
    !body.trim()
  ) {
    return res.status(400).json({
      error: 'Subject and message are required.'
    });
  }

  if (subject.length > 180 || body.length > 30000) {
    return res.status(400).json({
      error: 'Subject or message exceeds the allowed length.'
    });
  }

  // Validate recipients
  if (
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    recipients.length > 200
  ) {
    return res.status(400).json({
      error: 'Provide between 1 and 200 recipients per batch.'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const cleanRecipients = [
    ...new Set(
      recipients
        .filter(email => typeof email === 'string')
        .map(email => email.trim().toLowerCase())
    )
  ];

  if (
    cleanRecipients.length !== recipients.length ||
    cleanRecipients.some(email => !emailRegex.test(email))
  ) {
    return res.status(400).json({
      error: 'The recipient list contains invalid or duplicate addresses.'
    });
  }

  // Validate optional signature URL
  let safeSignature = '';

  if (signatureUrl) {
    try {
      const parsed = new URL(signatureUrl);

      if (
        parsed.protocol !== 'https:' ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error('Invalid signature URL');
      }

      safeSignature = parsed.href;
    } catch {
      return res.status(400).json({
        error: 'Signature must be a valid HTTPS image URL.'
      });
    }
  }

  // Escape HTML to prevent injected markup
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  // Format message
  const safeSubject = escapeHTML(subject.trim());

  const paragraphs = escapeHTML(body.trim())
    .split(/\n{2,}/)
    .map(paragraph => `
      <p style="
        margin:0 0 18px;
        line-height:1.9;
        color:#49433d;
        font-size:15px;
      ">
        ${paragraph.replace(/\n/g, '<br>')}
      </p>
    `)
    .join('');

  const signature = safeSignature
    ? `
      <img
        src="${escapeHTML(safeSignature)}"
        alt="Signature"
        style="
          display:block;
          max-width:240px;
          max-height:110px;
          height:auto;
          margin-top:22px;
        "
      >
    `
    : '';

  // Premium LINK email template
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
  </head>

  <body style="
    margin:0;
    padding:0;
    background:#f8f6f1;
    font-family:Arial,sans-serif;
  ">

    <table width="100%" cellpadding="0" cellspacing="0"
      border="0" style="background:#f8f6f1;padding:35px 12px;">

      <tr>
        <td align="center">

          <table width="600" cellpadding="0" cellspacing="0"
            border="0" style="
              max-width:600px;
              width:100%;
              background:#ffffff;
            ">

            <!-- HEADER -->
            <tr>
              <td style="
                background:#7b1c1c;
                padding:34px 35px 30px;
              ">
                <div style="
                  font-family:Georgia,serif;
                  font-size:30px;
                  letter-spacing:7px;
                  color:#ffffff;
                ">LINK</div>

                <div style="
                  font-size:9px;
                  letter-spacing:3px;
                  color:#e7d8b6;
                  margin-top:8px;
                ">
                  CONNECTION • OPPORTUNITY • GROWTH
                </div>
              </td>
            </tr>

            <!-- MESSAGE -->
            <tr>
              <td style="padding:38px 35px 12px;">

                <div style="
                  width:42px;
                  height:2px;
                  background:#b99a55;
                "></div>

                <h1 style="
                  font-family:Georgia,serif;
                  font-weight:normal;
                  font-size:25px;
                  line-height:1.4;
                  color:#7b1c1c;
                  margin:25px 0;
                ">${safeSubject}</h1>

              </td>
            </tr>

            <tr>
              <td style="padding:0 35px 35px;">
                ${paragraphs}
                ${signature}
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="
                padding:25px 35px;
                background:#f8f6f1;
                border-top:1px solid #e9e4dc;
              ">

                <div style="
                  font-family:Georgia,serif;
                  font-size:19px;
                  letter-spacing:4px;
                  color:#7b1c1c;
                ">LINK</div>

                <p style="
                  font-size:11px;
                  color:#756e65;
                  line-height:1.9;
                  margin:12px 0;
                ">
                  SECURE. SAFE. SWIFT.<br>

                  <a href="mailto:office@getlinked.co.za"
                    style="color:#7b1c1c;text-decoration:none;">
                    office@getlinked.co.za
                  </a><br>

                  <a href="https://www.getlinked.co.za"
                    style="color:#7b1c1c;text-decoration:none;">
                    www.getlinked.co.za
                  </a><br>

                  +27 74 571 8332
                </p>

                <div style="
                  font-size:9px;
                  color:#aaa197;
                  letter-spacing:1px;
                  margin-top:18px;
                ">
                  CONNECT. GROW. MOVE FORWARD.
                </div>

              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>

  </body>
  </html>
  `;

  // Send individual emails through Brevo
  const results = [];

  for (const email of cleanRecipients) {
    try {
      const response = await fetch(
        'https://api.brevo.com/v3/smtp/email',
        {
          method: 'POST',

          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': process.env.BREVO_API_KEY
          },

          body: JSON.stringify({
            sender: {
              email: process.env.SENDER_EMAIL,
              name: process.env.SENDER_NAME
            },

            to: [{ email }],

            subject: subject.trim(),

            htmlContent,

            textContent: body.trim(),

            tags: ['LINK-Email-Distribution']
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        results.push({
          email,
          status: 'sent',
          messageId: data.messageId || null
        });
      } else {
        results.push({
          email,
          status: 'failed',
          error: data.message || data.code || 'Brevo rejected the email.'
        });
      }

    } catch (error) {
      results.push({
        email,
        status: 'failed',
        error: error.message
      });
    }
  }

  const successful = results.filter(
    result => result.status === 'sent'
  ).length;

  return res.status(200).json({
    total: results.length,
    successful,
    failed: results.length - successful,
    results
  });
}
