/** Strict, testable group scheduling policy. No database or Electron access. */
import type { TheoryInput, TeachingAllocation, TheorySlot, TheorySection } from './theoryRules.ts';

// Codes such as L1/LANG1 remain recognizable when the catalogue display name is localized.
export function isLanguageOne(subject: string, code?: string | null): boolean {
  return /\b(?:language|lang)[\s_-]*0?1\b/i.test(subject)
    || /^(?:L1|LANG1|LANGUAGE1|LANG[_-]1|LANGUAGE[_-]1)$/i.test((code || '').trim());
}
export function sectionYear(section: TheorySection): number | null {
  if (Number.isInteger(section.semesterNumber) && section.semesterNumber! >= 1 && section.semesterNumber! <= 6) return section.semesterNumber!;
  const m = /^semester\s+([1-6])\s*-/i.exec(section.label);
  return m ? Number(m[1]) : null;
}
export function sectionCode(section: TheorySection): string {
  if (section.code) return section.code.trim().toUpperCase();
  const m = /^semester\s+[1-6]\s*-\s*([A-Za-z0-9-]+)$/i.exec(section.label);
  return m ? m[1].toUpperCase() : '';
}
export type LanguageOneGroup = { semester: number; sections: TheorySection[]; allocations: TeachingAllocation[]; hours: number };

/** Fail closed rather than manufacture assignments or silently omit a section. */
/** Synchronize only the ACTIVE sections A/B/C provided for the selected term. */
export function requireLanguageOneGroups(input: TheoryInput): LanguageOneGroup[] {
  const groups: LanguageOneGroup[] = [];
  const faculty = new Set(input.faculty.map(f => f.id));
  const activeSections = new Map(input.sections.map(s => [s.id, s]));
  const eligible = (s: TheorySection) => ['A', 'B', 'C'].includes(sectionCode(s));
  const language = input.allocations.filter(a => {
    const section = activeSections.get(a.sectionId);
    return section !== undefined && eligible(section) && isLanguageOne(a.subject, a.subjectCode);
  });
  const semesters = [...new Set(language.map(a => sectionYear(activeSections.get(a.sectionId)!)))];
  for (const semester of semesters) {
    if (semester === null) throw new Error('Language 1 allocation belongs to an unknown semester/section.');
    const active = input.sections.filter(s => sectionYear(s) === semester && eligible(s));
    const codes = active.map(sectionCode);
    if (codes.length !== new Set(codes).size)
      throw new Error(`Semester ${semester} has duplicate active section codes in A/B/C. Check Academic Setup.`);
    const ordered = ['A', 'B', 'C'].flatMap(code => active.filter(s => sectionCode(s) === code));
    const perSection = ordered.map(s => language.filter(a => a.sectionId === s.id));
    if (perSection.some(items => items.length !== 1)) {
      const missing = ordered.filter((s, i) => perSection[i].length !== 1).map(sectionCode).join(', ');
      throw new Error(`Semester ${semester} needs exactly one Language 1 allocation in each active section; check ${missing}. Inactive sections are never required.`);
    }
    const allocations = perSection.map(items => items[0]);
    if (allocations.some(a => !['Theory', 'Language'].includes(a.kind)))
      throw new Error(`Semester ${semester} Language 1 allocations must be Theory or Language subjects.`);
    const hours = allocations[0].hours;
    if (!Number.isInteger(hours) || hours <= 0 || allocations.some(a => a.hours !== hours))
      throw new Error(`Semester ${semester} Language 1 weekly hours must be equal, positive integers for active sections ${codes.join(', ')}.`);
    if (allocations.some(a => !a.facultyId || !a.facultyActive || !faculty.has(a.facultyId)))
      throw new Error(`Semester ${semester} Language 1 needs an active assigned faculty member for each active section.`);
    if (new Set(allocations.map(a => a.facultyId)).size !== allocations.length)
      throw new Error(`Semester ${semester} Language 1 requires a different faculty member for each simultaneous active section.`);
    groups.push({semester, sections: ordered, allocations, hours});
  }
  return groups.sort((a, b) => a.semester - b.semester);
}

/** Assert every scheduled weekly Language 1 occurrence uses the SAME day and period for the active sections. */
export function assertLanguageOneSynchronization(groups: LanguageOneGroup[], slots: TheorySlot[], requireComplete: boolean): void {
  for (const group of groups) {
    const byAllocation = group.allocations.map(a => slots.filter(s => s.allocationId === a.id).map(s => `${s.day}|${s.period}`).sort());
    for (const placed of byAllocation.slice(1)) {
      if (placed.length !== byAllocation[0].length || placed.some((key,i) => key !== byAllocation[0][i]))
        throw new Error(`Semester ${group.semester} Language 1 is not simultaneous among active sections.`);
    }
    if (requireComplete && byAllocation[0].length !== group.hours)
      throw new Error(`Semester ${group.semester} Language 1 has only ${byAllocation[0].length}/${group.hours} synchronized periods. Resolve clashes before saving.`);
  }
}
