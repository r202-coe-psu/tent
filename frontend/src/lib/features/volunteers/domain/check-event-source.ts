import type { CheckInMethod } from './shift-assignment.schema';

/** Who performed a check-in/out, as shown in the roster audit trail (#871). */
export type CheckEventSource = 'self' | 'staff_qr' | 'staff_manual' | 'unknown';

export type CheckEventKind = 'check_in' | 'check_out';

export type CheckEventInput = {
	kind: CheckEventKind;
	/** Legacy docs may lack a method — treated as `unknown`, never guessed. */
	method?: CheckInMethod | null;
	/** `check_in_by` / `check_out_by`. */
	by?: string | null;
	reason?: string | null;
	volunteerName: string;
};

export type CheckEventDescription = {
	source: CheckEventSource;
	/** Source badge text (without the "(Source)" suffix). */
	sourceLabel: string;
	actorLine: string;
	noteLine: string;
	/** Audit-trail filter group: volunteer did it themselves vs. staff acted. */
	group: 'self' | 'staff' | 'unknown';
};

const UNSPECIFIED = 'ไม่ระบุ';

function sourceOf(method: CheckInMethod | null | undefined): CheckEventSource {
	if (method === 'portal') return 'self';
	if (method === 'qr') return 'staff_qr';
	if (method === 'manual_override') return 'staff_manual';
	return 'unknown';
}

/**
 * Pure method → audit-trail wording. Staff rows show `by` (the staff member);
 * a `portal` row always shows the volunteer, because its `by` is the system
 * marker `volunteer_portal`, not a person.
 */
export function describeCheckEvent(input: CheckEventInput): CheckEventDescription {
	const { kind, by, volunteerName } = input;
	const source = sourceOf(input.method);
	const isIn = kind === 'check_in';
	const actor = by?.trim() || null;
	const staff = actor ?? 'จนท.';
	const defaultNote = isIn ? 'ตรงเวลากะทำงาน' : 'ปฏิบัติงานเสร็จสิ้น / ออกจากศูนย์';

	switch (source) {
		case 'self':
			return {
				source,
				sourceLabel: isIn ? 'จิตอาสาเช็คอินเอง' : 'จิตอาสาเช็คเอาต์เอง',
				actorLine: `${volunteerName} (${isIn ? 'เช็คอินด้วยตนเอง' : 'เช็คเอาต์ด้วยตนเอง'})`,
				noteLine: defaultNote,
				group: 'self'
			};
		case 'staff_qr':
			return {
				source,
				// `qr` is also written by the one-click roster buttons and a typed search, so the
				// wording does not claim a scan.
				sourceLabel: isIn ? 'จนท. เช็คอินให้' : 'จนท. เช็คเอาต์ให้',
				actorLine: `${staff} (${isIn ? 'เช็คอินให้' : 'เช็คเอาต์ให้'})`,
				noteLine: defaultNote,
				group: 'staff'
			};
		case 'staff_manual':
			return {
				source,
				sourceLabel: isIn ? 'จนท. เช็คอินแทน' : 'จนท. เช็คเอาต์แทน',
				actorLine: `${staff} (${isIn ? 'เช็คอินแทนหน้างาน' : 'เช็คเอาต์แทนหน้างาน'})`,
				noteLine: input.reason?.trim() || '—',
				group: 'staff'
			};
		default:
			return {
				source,
				sourceLabel: UNSPECIFIED,
				actorLine: actor ?? UNSPECIFIED,
				noteLine: defaultNote,
				group: 'unknown'
			};
	}
}
