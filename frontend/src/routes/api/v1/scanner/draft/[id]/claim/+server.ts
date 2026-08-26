import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerRepository } from '$lib/features/scanners';

export const prerender = false;

export const POST: RequestHandler = async ({ params, request, url }) => {
	try {
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing draft ID' }, { status: 400 });
		}

		const body = await request.json().catch(() => ({}));
		const claimedBy = body.claimed_by || 'staff';
		const shelterCode = body.shelter_code || url.searchParams.get('shelter_code') || undefined;

		const claimed = await scannerRepository.claimDraft(id, claimedBy, shelterCode);

		return json({
			ok: true,
			item: claimed
		});
	} catch (err) {
		console.error('[Scanner Draft Claim] Error claiming draft:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Internal Server Error' },
			{ status: 500 }
		);
	}
};
