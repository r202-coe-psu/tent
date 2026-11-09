import type { VolunteerStatus } from './volunteer.schema';

export interface ExistingVolunteerSummary {
	_id: string;
	volunteer_code?: string;
	first_name: string;
	last_name: string;
	status: VolunteerStatus;
}

/**
 * Format Thai error message for duplicate volunteer phone (CR-239 FR-9).
 * Message format:
 * `เบอร์นี้มีอยู่แล้วในศูนย์: V-012 สมชาย ใจดี` (or multiple separated by `, `)
 * Inactive profiles append ` (ปิดใช้งานอยู่)`
 */
export function formatVolunteerPhoneTakenMessage(existing: ExistingVolunteerSummary[]): string {
	const sorted = [...existing].sort((a, b) =>
		(a.volunteer_code || '').localeCompare(b.volunteer_code || '')
	);
	const names = sorted.map((v) => {
		const base = `${v.volunteer_code || ''} ${v.first_name} ${v.last_name}`.trim();
		return v.status === 'inactive' ? `${base} (ปิดใช้งานอยู่)` : base;
	});
	return `เบอร์นี้มีอยู่แล้วในศูนย์: ${names.join(', ')}`;
}

/**
 * Thrown when trying to create or update a volunteer profile with a phone number
 * that already belongs to another non-merged volunteer in the same shelter (CR-239).
 */
export class VolunteerPhoneTakenError extends Error {
	readonly code = 'VOLUNTEER_PHONE_TAKEN' as const;
	readonly existing: ExistingVolunteerSummary[];

	constructor(existing: ExistingVolunteerSummary[]) {
		const sorted = [...existing].sort((a, b) =>
			(a.volunteer_code || '').localeCompare(b.volunteer_code || '')
		);
		super(formatVolunteerPhoneTakenMessage(sorted));
		this.name = 'VolunteerPhoneTakenError';
		this.existing = sorted;
	}
}

export function isVolunteerPhoneTakenError(e: unknown): e is VolunteerPhoneTakenError {
	return (
		e instanceof VolunteerPhoneTakenError ||
		(e instanceof Error && (e as { code?: string }).code === 'VOLUNTEER_PHONE_TAKEN')
	);
}
