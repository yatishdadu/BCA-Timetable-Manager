/** Local coordinator credential input checks (no network or cloud accounts). */
export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}
export function validUsername(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalizeIdentity(value));
}
export function validEmployeeCode(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(value.trim());
}
export function validPassword(value: string): boolean {
  return value.length >= 12 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}
export function normalizeRecoveryCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
export function validRecoveryCode(value: string): boolean {
  return /^[A-F0-9]{48}$/.test(normalizeRecoveryCode(value));
}
export function groupRecoveryCode(hex: string): string {
  return hex.toUpperCase().match(/.{1,8}/g)?.join('-') ?? '';
}
