import { put } from '@vercel/blob';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB after the browser has resized the image

function detectType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'image/png', ext: 'png' };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Image storage is not configured (BLOB_READ_WRITE_TOKEN missing).' });
  }

  const { kind, dataUrl } = req.body || {};
  if (!['logo', 'signature'].includes(kind) || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Invalid upload request.' });
  }

  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/') || comma === -1 || !dataUrl.slice(0, comma).endsWith(';base64')) {
    return res.status(400).json({ error: 'Image must be sent as a base64 data URL.' });
  }

  const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'Image is empty or larger than 2 MB.' });
  }

  const detected = detectType(buffer); // checks real file contents, not just the claimed type
  if (!detected) {
    return res.status(400).json({ error: 'Only PNG or JPEG images are supported.' });
  }

  try {
    const blob = await put(`link-email/${kind}.${detected.ext}`, buffer, {
      access: 'public',
      contentType: detected.type,
      addRandomSuffix: true
    });
    return res.status(200).json({ url: blob.url });
  } catch (error) {
    return res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
}
