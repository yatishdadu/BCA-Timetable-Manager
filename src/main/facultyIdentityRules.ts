/** Pure rules for coordinator-managed faculty identifiers and safe deletion. */
export function normalizeFacultyCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_\/-]{1,31}$/.test(code)) {
    throw new Error('Faculty ID must be 2-32 characters: letters, digits, hyphen, underscore or slash');
  }
  return code;
}

export function canPermanentlyDelete(active: boolean, references: readonly string[]): boolean {
  return !active && references.length === 0;
}
