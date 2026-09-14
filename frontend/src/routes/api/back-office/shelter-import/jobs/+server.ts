import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { requireAdmin, serviceError } from '$lib/server/couch-admin';
import { createShelterSchema } from '$lib/features/shelters/server';
import {
	createImportJob,
	MAX_IMPORT_ROWS,
	type ImportItemError
} from '$lib/features/shelter-import/server/job-store';

export const prerender = false;
const MAX_IMPORT_BODY_BYTES = 5 * 1024 * 1024;

const rowSchema = z.object({
	row: z.number().int().positive(),
	name: z.string().max(500).nullable(),
	shelter: z.unknown().optional(),
	errors: z
		.array(
			z.object({
				column: z.string().max(100),
				message: z.string().max(500),
				sheet: z.string().max(100).optional(),
				line: z.number().int().optional()
			})
		)
		.max(20)
		.optional()
});

const bodySchema = z.object({
	filename: z.string().trim().min(1).max(255),
	duplicate_action: z.enum(['skip', 'update']),
	rows: z.array(rowSchema).min(1).max(MAX_IMPORT_ROWS)
});

export const POST: RequestHandler = async ({ request }) => {
	const caller = await requireAdmin(request.headers.get('cookie'));
	try {
		if (!env.SHELTER_IMPORT_WORKER_TOKEN) {
			return json(
				{
					error: { code: 'SERVICE_UNAVAILABLE', message: 'Shelter import worker is not configured' }
				},
				{ status: 503 }
			);
		}
		const contentLength = Number(request.headers.get('content-length') ?? 0);
		if (contentLength > MAX_IMPORT_BODY_BYTES) {
			return json(
				{ error: { code: 'VALIDATION', message: 'Import request is too large' } },
				{ status: 413 }
			);
		}
		const raw = await request.text();
		if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BODY_BYTES) {
			return json(
				{ error: { code: 'VALIDATION', message: 'Import request is too large' } },
				{ status: 413 }
			);
		}
		const body = bodySchema.parse(JSON.parse(raw));
		const rows = body.rows.map((row) => {
			const parsed = row.shelter === undefined ? null : createShelterSchema.safeParse(row.shelter);
			const errors: ImportItemError[] = [...(row.errors ?? [])];
			if (!parsed || !parsed.success) {
				if (parsed && !parsed.success) {
					for (const issue of parsed.error.issues) {
						errors.push({ column: issue.path.join('.') || '-', message: issue.message });
					}
				} else {
					errors.push({ column: '-', message: 'Missing shelter payload' });
				}
			}
			return {
				row: row.row,
				name: row.name,
				...(parsed?.success && errors.length === 0 ? { input: parsed.data } : {}),
				errors: errors.length ? errors : undefined,
				valid: Boolean(parsed?.success && errors.length === 0)
			};
		});
		const job = await createImportJob({
			filename: body.filename,
			importedBy: caller,
			duplicateAction: body.duplicate_action,
			rows
		});
		return json({ jobId: job._id.slice('shelter_import_job:'.length) }, { status: 202 });
	} catch (e) {
		return serviceError(e);
	}
};
