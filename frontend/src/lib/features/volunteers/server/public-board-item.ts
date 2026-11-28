/**
 * Shapes a CouchDB job document into the card the public board renders — the same fields as
 * FastAPI's `PublicJobItem`, nothing more. The fallback reads jobs with the admin credential, so
 * returning the document itself would hand a signed-out visitor staff ids (`created_by`),
 * applicant ids (`released_application_ids`) and internal shift fields (#1470 review W-2).
 *
 * Server-only and pure: no I/O, no Svelte.
 */

interface DocShift {
	id?: string;
	shift_id?: string;
	date?: string;
	end_date?: string | null;
	start_time?: string;
	end_time?: string;
	station?: string | null;
	quota?: number;
	slots_confirmed?: number;
	confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
	applicants_count?: number;
}

export interface BoardJobDoc {
	_id: string;
	job_id?: string;
	title?: string;
	description?: string;
	status?: string;
	shelter_code?: string;
	tier?: string;
	skills_required?: string[];
	shift_template?: {
		shift_name?: string;
		start_time?: string;
		end_time?: string;
		days?: string[];
	};
	shifts?: DocShift[];
	quota?: number;
	slots_confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
	applicants_count?: number;
	is_urgent?: boolean;
}

export interface PublicBoardShift {
	shift_id: string;
	date: string;
	end_date: string | null;
	start_time: string;
	end_time: string;
	station: string | null;
	quota: number;
	slots_confirmed: number;
	slots_dispatched: number;
	slots_remaining: number;
	applicants_count: number;
}

export interface PublicBoardItem {
	job_id: string;
	shelter_code: string;
	shelter_name: string;
	title: string;
	description: string;
	tier: string;
	skills_required: string[];
	shift_template: { shift_name: string; start_time: string; end_time: string; days: string[] };
	shifts: PublicBoardShift[];
	quota: number;
	slots_confirmed: number;
	slots_remaining: number;
	applicants_count: number;
	status: string;
	is_urgent: boolean;
}

const remaining = (row: {
	quota?: number;
	slots_confirmed?: number;
	confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
}): number =>
	row.slots_remaining ??
	Math.max(
		(row.quota ?? 0) - (row.slots_confirmed ?? row.confirmed ?? 0) - (row.slots_dispatched ?? 0),
		0
	);

export function toPublicBoardItem(
	doc: BoardJobDoc,
	shelterNames: ReadonlyMap<string, string>
): PublicBoardItem {
	const code = doc.shelter_code ?? '';
	const template = doc.shift_template ?? {};
	return {
		job_id: doc.job_id ?? doc._id,
		shelter_code: code,
		shelter_name: shelterNames.get(code.toUpperCase()) ?? '',
		title: doc.title ?? '',
		description: doc.description ?? '',
		tier: doc.tier ?? 'operational',
		skills_required: [...(doc.skills_required ?? [])],
		shift_template: {
			shift_name: template.shift_name ?? '',
			start_time: template.start_time ?? '',
			end_time: template.end_time ?? '',
			days: [...(template.days ?? [])]
		},
		shifts: (doc.shifts ?? []).map((shift) => ({
			shift_id: shift.shift_id ?? shift.id ?? '',
			date: shift.date ?? '',
			end_date: shift.end_date ?? null,
			start_time: shift.start_time ?? '',
			end_time: shift.end_time ?? '',
			station: shift.station ?? null,
			quota: shift.quota ?? 0,
			slots_confirmed: shift.slots_confirmed ?? shift.confirmed ?? 0,
			slots_dispatched: shift.slots_dispatched ?? 0,
			slots_remaining: remaining(shift),
			applicants_count: shift.applicants_count ?? 0
		})),
		quota: doc.quota ?? 0,
		slots_confirmed: doc.slots_confirmed ?? 0,
		slots_remaining: remaining(doc),
		applicants_count: doc.applicants_count ?? 0,
		status: doc.status === 'almost_full' ? 'open' : (doc.status ?? 'open'),
		is_urgent: doc.is_urgent ?? false
	};
}
