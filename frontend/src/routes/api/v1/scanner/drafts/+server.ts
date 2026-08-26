import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';

export const prerender = false;

export const GET: RequestHandler = async ({ url }) => {
	try {
		const shelterCode = url.searchParams.get('shelter_code') || 'SH001';
		const drafts = await scannerServerRepository.listPendingDrafts(shelterCode);

		return json({
			ok: true,
			items: drafts
		});
	} catch (err) {
		console.error('[Scanner Drafts] Error fetching pending drafts:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Internal Server Error' },
			{ status: 500 }
		);
	}
};
