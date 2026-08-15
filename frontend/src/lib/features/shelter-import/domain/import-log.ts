import { z } from 'zod';
import { catalogDoc, type CatalogDoc } from '$lib/db/model';
import type { RowStatus } from './import-row';

/**
 * `shelter_import_log` — one append-only record per Excel import batch
 * (CR-039, schema.md §3.7). Lives in the `registry` DB, so it uses the central
 * envelope (`CatalogDoc` — no `shelter_code`). `_id = shelter_import_log:{ulid}`
 * (type-prefixed so `allByType` finds it via a plain `_all_docs` prefix scan).
 */

export const SHELTER_IMPORT_LOG_TYPE = 'shelter_import_log' as const;
// v2: adds `updated_count` / `skipped_count` (duplicate-by-name handling). Additive
// only — v1 docs simply lack the two counters and still read back fine.
export const SHELTER_IMPORT_LOG_SCHEMA_V = 2 as const;

export interface ImportRowResult {
	row: number;
	name: string | null;
	status: RowStatus;
	code?: string;
	/** Set when the row was updated or skipped because it duplicates an existing shelter. */
	existing_code?: string;
	errors?: { column: string; message: string; sheet?: string; line?: number }[];
}

export interface ShelterImportLog extends CatalogDoc {
	type: typeof SHELTER_IMPORT_LOG_TYPE;
	schema_v: typeof SHELTER_IMPORT_LOG_SCHEMA_V;
	source: 'shelter';
	filename: string;
	imported_by: string;
	total_rows: number;
	success_count: number;
	updated_count: number;
	skipped_count: number;
	error_count: number;
	results: ImportRowResult[];
	started_at: string;
	finished_at: string;
}

const rowResultSchema = z.object({
	row: z.number().int(),
	name: z.string().nullable(),
	status: z.enum(['created', 'updated', 'skipped_duplicate', 'validation_error', 'server_error']),
	code: z.string().optional(),
	existing_code: z.string().optional(),
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
export const shelterImportLogBodySchema = z.object({
	source: z.literal('shelter'),
	filename: z.string().trim().min(1),
	imported_by: z.string().trim().min(1),
	total_rows: z.number().int().min(0),
	success_count: z.number().int().min(0),
	updated_count: z.number().int().min(0).default(0),
	skipped_count: z.number().int().min(0).default(0),
	error_count: z.number().int().min(0),
	results: z.array(rowResultSchema),
	started_at: z.string().datetime(),
	finished_at: z.string().datetime()
});
export type ShelterImportLogBody = z.infer<typeof shelterImportLogBodySchema>;

/** Mint a fresh log doc (registry envelope, ULID id). */
export function createShelterImportLog(
	body: ShelterImportLogBody,
	createdBy: string
): ShelterImportLog {
	return catalogDoc(
		SHELTER_IMPORT_LOG_TYPE,
		SHELTER_IMPORT_LOG_SCHEMA_V,
		body,
		createdBy
	) as ShelterImportLog;
}

export const isShelterImportLog = (d: unknown): d is ShelterImportLog =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === SHELTER_IMPORT_LOG_TYPE;
