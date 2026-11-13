/**
 * Read-only timetable labels. Uses names already returned by master:snapshot.
 * Never invents a teacher or a section for a missing allocation.
 */
export type TimetableAssignmentEvent = {
  sectionIds: string[];
  facultyId: string | null;
};
export type SectionLabel = { id: string; label: string };
export type FacultyLabel = { id: string; name: string };

export type AssignmentLabels = {
  sections: string;
  faculty: string;
  missingSections: boolean;
  missingFaculty: boolean;
};

export function assignmentLabels(
  event: TimetableAssignmentEvent,
  sections: ReadonlyArray<SectionLabel>,
  faculty: ReadonlyArray<FacultyLabel>,
): AssignmentLabels {
  const sectionNames = new Map(sections.map(item => [item.id, item.label]));
  const facultyNames = new Map(faculty.map(item => [item.id, item.name]));
  const sectionIds = [...new Set(event.sectionIds)];
  const sectionValues = sectionIds.map(id => sectionNames.get(id) || 'Section record unavailable');
  const missingSections = !sectionIds.length || sectionIds.some(id => !sectionNames.has(id));
  const assignedFaculty = event.facultyId ? facultyNames.get(event.facultyId) : undefined;
  const missingFaculty = !assignedFaculty;
  return {
    sections: sectionValues.length ? sectionValues.join(', ') : 'No BCA section linked',
    faculty: assignedFaculty || (event.facultyId ? 'Faculty record unavailable — review assignment' : 'Not assigned / not recorded'),
    missingSections,
    missingFaculty,
  };
}
