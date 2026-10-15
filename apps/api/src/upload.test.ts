import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { sanitizeImage, uploadDir } from './upload.js';
import { resolve } from 'node:path';

describe('image upload validation', () => {
  it('resolves an absolute upload directory without nesting it under cwd', () => {
    expect(uploadDir).toBe(resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads'));
  });
  it('decodes and re-encodes a valid image', async () => {
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#dd4422' } })
      .png()
      .toBuffer();
    const output = await sanitizeImage(input, 'image/png', 'map.png');
    expect(output.mime).toBe('image/webp');
    expect(output.width).toBe(2);
    expect((await sharp(output.bytes).metadata()).format).toBe('webp');
  });
  it('rejects MIME spoofing, scripts and unsafe names', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    await expect(sanitizeImage(png, 'image/jpeg', 'map.jpg')).rejects.toThrow('格式');
    await expect(sanitizeImage(Buffer.from('<svg><script/></svg>'), 'image/png', 'map.png')).rejects.toThrow();
    await expect(sanitizeImage(png, 'image/png', '../../map.png')).rejects.toThrow('扩展名');
  });
});
