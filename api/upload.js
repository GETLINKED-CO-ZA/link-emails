
import { put } from '@vercel/blob';

// Keep uploads small enough for Vercel's request-body limit.
const MAX_BYTES = 2 * 1024 * 1024;

function detectType(buf) {
  if (buf.length > 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47) {
    return { type: 'image/png', ext: 'png' };
  }

  if (buf.length > 3 &&
      buf[0] === 0xff &&
      buf[1] === 0xd8 &&
      buf[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }

  if (buf.length > 6 &&
      (buf.toString('ascii', 0, 6) === 'GIF87a' ||
       buf.toString('ascii', 0, 6) === 'GIF89a')) {
    return { type: 'image/gif', ext: 'gif' };
  }

  if (buf.length > 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: 'Image storage is not configured (BLOB_READ_WRITE_TOKEN missing).'
    });
  }

  const { kind, dataUrl } = req.body || {};

  if (!['logo', 'signature', 'image'].includes(kind) ||
      typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Invalid upload request.' });
  }

  const comma = dataUrl.indexOf(',');

  if (!dataUrl.startsWith('data:image/') ||
      comma === -1 ||
      !dataUrl.slice(0, comma).endsWith(';base64')) {
    return res.status(400).json({
      error: 'Image must be sent as a base64 data URL.'
    });
  }

  const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');

  if (!buffer.length || buffer.length > MAX_BYTES) {
    return res.status(400).json({
      error: 'Image is empty or larger than 2 MB after resizing.'
    });
  }

  const detected = detectType(buffer);

  if (!detected) {
    return res.status(400).json({
      error: 'Only PNG, JPEG, GIF or WebP images are supported.'
    });
  }

  try {
    const filename = kind === 'image' ? 'content-image' : kind;

    const blob = await put(
      `link-email/${filename}.${detected.ext}`,
      buffer,
      {
        access: 'public',
        contentType: detected.type,
        addRandomSuffix: true
      }
    );

    return res.status(200).json({ url: blob.url });

  } catch (error) {
    return res.status(500).json({
      error: 'Upload failed: ' + error.message
    });
  }
}
