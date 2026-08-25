import { z } from 'zod';
import { makeDoc, type AuthorContext, type BaseDoc } from '$lib/db/model';
import type { RowStatus } from './import-row';

/**
 * `people_import_log` — one append-only record per household-import batch
 * (CR-071 slice A / T-72, pattern from CR-039's `shelter_import_log`).
 *
 * Unlike the shelter log this one lives in the **shelter database**, not the
 * central `registry`: its `results[]` carry evacuee names, so keeping it beside
 * the people it describes keeps the same shelter-scope isolation the rest of
 * the people data has. `_id = people_import_log:{ulid}` (type-prefixed so
 * `allByType` finds it via a plain `_all_docs` prefix scan).
 */

export const PEOPLE_IMPORT_LOG_TYPE = 'people_import_log' as const;
export const PEOPLE_IMPORT_LOG_SCHEMA_V = 1 as const;

export interface ImportRowResult {
	/** 1-based data row on the household sheet. */
	row: number;
	label: string | null;
	status: RowStatus;
	/** Set when the household document was created. */
	household_id?: string;
	/** Members written for this household (excludes the head). */
	created_members?: number;
	/** Members skipped because they already exist in this shelter. */
	skipped_members?: number;
	/** Set when the household was skipped because its head already exists. */
	existing_evacuee_id?: string;
	errors?: { column: string; message: string; sheet?: string; line?: number }[];
}

export interface PeopleImportLog extends BaseDoc {
	type: typeof PEOPLE_IMPORT_LOG_TYPE;
	schema_v: typeof PEOPLE_IMPORT_LOG_SCHEMA_V;
	source: 'people';
	filename: string;
	imported_by: string;
	/** Households read from the file. */
	total_rows: number;
	/** Households created. */
	success_count: number;
	/** Households skipped because the head already exists in this shelter. */
	skipped_count: number;
	/** Households that failed validation or a write. */
	error_count: number;
	/** People written across every successful household (heads + members). */
	created_people: number;
	/** People skipped as duplicates of someone already in this shelter. */
	skipped_people: number;
	results: ImportRowResult[];
	started_at: string;
	finished_at: string;
}

const rowResultSchema = z.object({
	row: z.number().int(),
	label: z.string().nullable(),
	status: z.enum(['created', 'skipped_duplicate', 'validation_error', 'server_error']),
	household_id: z.string().optional(),
	created_members: z.number().int().min(0).optional(),
	skipped_members: z.number().int().min(0).optional(),
	existing_evacuee_id: z.string().optional(),
	errors: z
		.array(
			z.object({
				column: z.string(),
				message: z.string(),
				sheet: z.string().optional(),
				line: z.number().int().optional()
			})
		)
		.optional()
});

/** Body (envelope-free) — the payload the factory stamps the envelope onto. */
export const peopleImportLogBodySchema = z.object({
	source: z.literal('people'),
	filename: z.string().trim().min(1),
	imported_by: z.string().trim().min(1),
	total_rows: z.number().int().min(0),
	success_count: z.number().int().min(0),
	skipped_count: z.number().int().min(0),
	error_count: z.number().int().min(0),
	created_people: z.number().int().min(0),
	skipped_people: z.number().int().min(0),
	results: z.array(rowResultSchema),
	started_at: z.string(),
	finished_at: z.string()
});
export type PeopleImportLogBody = z.infer<typeof peopleImportLogBodySchema>;

/**
 * Caps on what one log doc carries. The counters above stay exact; only the
 * per-row detail is bounded, so a 200-row file full of errors cannot grow the
 * doc without limit, and a long error message (they can quote a cell's text)
 * cannot drag a whole cell of user-entered data into a permanent audit doc.
 */
export const MAX_LOGGED_RESULTS = 200;
export const MAX_LOGGED_MESSAGE = 200;

function trimResult(r: ImportRowResult): ImportRowResult {
	if (!r.errors?.length) return r;
	return {
		...r,
		errors: r.errors.map((e) =>
			e.message.length <= MAX_LOGGED_MESSAGE
				? e
				: { ...e, message: `${e.message.slice(0, MAX_LOGGED_MESSAGE)}…` }
		)
	};
}

/** Mint a fresh log doc (shelter envelope, ULID id). */
export function createPeopleImportLog(
	body: PeopleImportLogBody,
	ctx: AuthorContext
): PeopleImportLog {
	const bounded: PeopleImportLogBody = {
		...body,
		results: body.results.slice(0, MAX_LOGGED_RESULTS).map(trimResult)
	};
	return makeDoc(
		PEOPLE_IMPORT_LOG_TYPE,
		PEOPLE_IMPORT_LOG_SCHEMA_V,
		bounded,
		ctx
	) as PeopleImportLog;
}

export const isPeopleImportLog = (d: unknown): d is PeopleImportLog =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === PEOPLE_IMPORT_LOG_TYPE;
