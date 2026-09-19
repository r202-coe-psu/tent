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
	food_distribution_points_present: z.boolean().optional(),
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

/** Read at most `limit` bytes so chunked requests cannot buffer unbounded input. */
async function readBodyWithinLimit(request: Request, limit: number): Promise<string | null> {
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

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
		const raw = await readBodyWithinLimit(request, MAX_IMPORT_BODY_BYTES);
		if (raw === null) {
			return json(
				{ error: { code: 'VALIDATION', message: 'Import request is too large' } },
				{ status: 413 }
			);
		}
		let parsedBody: z.infer<typeof bodySchema>;
		try {
			parsedBody = bodySchema.parse(JSON.parse(raw));
		} catch (error) {
			if (error instanceof z.ZodError) {
				return json(
					{
						error: { code: 'VALIDATION', message: 'Invalid import request', details: error.issues }
					},
					{ status: 422 }
				);
			}
			return json(
				{ error: { code: 'VALIDATION', message: 'Request body must be valid JSON' } },
				{ status: 422 }
			);
		}
		const body = parsedBody;
		const rows = body.rows.map((row) => {
			const parsed = row.shelter === undefined ? null : createShelterSchema.safeParse(row.shelter);
			const errors: ImportItemError[] = [];
			const clientValidationFailed = (row.errors?.length ?? 0) > 0;
			if (!parsed || !parsed.success) {
				if (parsed && !parsed.success) {
					for (const issue of parsed.error.issues) {
						errors.push({ column: issue.path.join('.') || '-', message: issue.message });
					}
				} else {
					errors.push({ column: '-', message: 'Missing shelter payload' });
				}
			}
			if (clientValidationFailed && parsed?.success) {
				errors.push({ column: '-', message: 'Row failed client-side validation' });
			}
			const input = parsed?.success && errors.length === 0 ? parsed.data : undefined;
			return {
				row: row.row,
				name: input?.name ?? (parsed?.success ? parsed.data.name : null),
				food_distribution_points_present: row.food_distribution_points_present === true,
				...(input ? { input } : {}),
				errors: errors.length ? errors : undefined,
				valid: Boolean(input)
			};
		});
		const job = await createImportJob({
			filename: body.filename,
			importedBy: caller,
			idempotencyKey: request.headers.get('idempotency-key') ?? '',
			duplicateAction: body.duplicate_action,
			rows
		});
		return json({ jobId: job._id.slice('shelter_import_job:'.length) }, { status: 202 });
	} catch (e) {
		return serviceError(e);
	}
};
