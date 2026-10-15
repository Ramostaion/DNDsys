import sharp from 'sharp';
export { uploadDir } from './storage.js';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 12000;
export const MAX_IMAGE_PIXELS = 40_000_000;
const allowed = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

/** Decode the full image and write fresh pixels, discarding metadata and embedded content. */
export async function sanitizeImage(bytes: Buffer, declaredMime: string, originalName: string) {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('图片超过 10MB');
  if (!allowed.has(declaredMime)) throw new Error('仅支持 JPEG、PNG 或 WebP 图片');
  if (!/^[^\\/\0]+\.(?:jpe?g|png|webp)$/i.test(originalName)) throw new Error('图片扩展名无效');
  const instance = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false });
  const metadata = await instance.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_IMAGE_SIDE ||
    metadata.height > MAX_IMAGE_SIDE ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS
  )
    throw new Error('图片尺寸超出限制');
  if (metadata.format !== allowed.get(declaredMime)) throw new Error('图片内容与声明格式不符');
  const output = await instance.rotate().webp({ quality: 85, effort: 4 }).toBuffer();
  return { bytes: output, width: metadata.width, height: metadata.height, mime: 'image/webp' };
}
