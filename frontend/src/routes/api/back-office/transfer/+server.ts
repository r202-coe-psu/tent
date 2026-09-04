/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeTransfer, resolveShelterCode, handleEndpointError } from './_auth';
import { TransferServerRepository } from '$lib/features/operations/data/transfer.server-repository';
import { transferInputSchema, transferStatusSchema } from '$lib/features/operations/server';

export const prerender = false;

/**
 * Shape check only — whether this POST is an undo of a delete rather than a new request.
 * The document inside is validated by `TransferServerRepository.restore()` (CR-090 FR-10).
 */
function isRestoreEnvelope(body: unknown): body is { restore: { doc: unknown } } {
	if (!body || typeof body !== 'object' || !('restore' in body)) return false;
	const restore = (body as { restore: unknown }).restore;
	return !!restore && typeof restore === 'object' && 'doc' in restore;
}

/**
 * GET /api/back-office/transfer
 * List transfers for a shelter (source or destination), filter by status.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const statusParam = url.searchParams.get('status') || undefined;
		const statusParsed = statusParam ? transferStatusSchema.safeParse(statusParam) : undefined;
		const status = statusParsed?.success ? statusParsed.data : undefined;

		const repo = new TransferServerRepository('central_ops', shelterCode);
		const list = await repo.list({ status });

		return json(list);
	} catch (e: unknown) {
		return handleEndpointError(e, 'Transfer API GET');
	}
};

/**
 * POST /api/back-office/transfer
 * Create a new inter-shelter transfer request (status `requested`).
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => ({}));

		// CR-090 FR-05 — undo of a delete rides this route as a SEPARATE code path, keyed off a
		// `restore` envelope. It deliberately does not widen `transferInputSchema` with an `_id`:
		// creating a request and putting a deleted one back are different operations with
		// different guards (FR-10), and merging them would let a normal create pick its own `_id`.
		if (isRestoreEnvelope(body)) {
			const repo = new TransferServerRepository('central_ops', shelterCode);
			const restored = await repo.restore(body.restore.doc, shelterCode);
			return json(restored, { status: 201 });
		}

		const parsed = transferInputSchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
		}

		if (parsed.data.from_shelter.toUpperCase() !== shelterCode.toUpperCase()) {
			return json({ error: 'from_shelter must match the creating shelter scope' }, { status: 422 });
		}
		if (parsed.data.from_shelter.toUpperCase() === parsed.data.to_shelter.toUpperCase()) {
			return json({ error: 'Cannot transfer to the same shelter' }, { status: 422 });
		}

		const repo = new TransferServerRepository('central_ops', shelterCode);
		const created = await repo.create(parsed.data, { shelterCode, createdBy: caller.name });

		return json(created, { status: 201 });
	} catch (e: unknown) {
		return handleEndpointError(e, 'Transfer API POST');
	}
};
