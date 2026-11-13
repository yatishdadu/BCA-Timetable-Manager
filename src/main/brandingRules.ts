/** Validated text + PNG/JPEG assets for offline institutional branding. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type LogoType = 'image/png' | 'image/jpeg';

export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  if (bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
}

export function validateDataUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Logo must be a PNG/JPG image or cleared.');
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Only PNG or JPG logos are supported.');
  const payload = match[2];
  if (payload.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4) throw new Error('Logo exceeds the 2 MB limit.');
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('Logo must be between 1 byte and 2 MB.');
  if (sniffLogoType(bytes) !== match[1]) throw new Error('Logo content does not match its image type.');
  // Reject malformed/corrupt base64 that Node would otherwise silently accept.
  if (bytes.toString('base64') !== payload) throw new Error('Logo image data is malformed.');
  return value;
}

export function logoDataUrl(bytes: Uint8Array): string {
  if (bytes.length > MAX_LOGO_BYTES) throw new Error('Logo exceeds the 2 MB limit.');
  const mime = sniffLogoType(bytes);
  if (!mime) throw new Error('Selected file is not a PNG or JPG image.');
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
