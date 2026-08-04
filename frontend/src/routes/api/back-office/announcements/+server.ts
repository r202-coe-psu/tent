import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import { listAnnouncements, saveAnnouncement } from '$lib/server/announcements-server';
import { createAnnouncement } from '$lib/features/announcements';

export const prerender = false;

export const GET: RequestHandler = async ({ request }) => {
	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'));
		const docs = await listAnnouncements();
		return json(docs);
	} catch (e) {
		return serviceError(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can create announcements');
		}

		const body = await request.json();
		if (!body || typeof body !== 'object') {
			throw new ServiceError('VALIDATION', 'Invalid body');
		}

		const newDoc = createAnnouncement(
			{
				title: body.title,
				description: body.description,
				severity: body.severity,
				is_active: body.is_active
			},
			{ createdBy: caller.name }
		);

		const result = await saveAnnouncement(newDoc);
		return json({ ok: true, id: newDoc._id, rev: result.rev, doc: newDoc });
	} catch (e) {
		console.error('POST announcement error:', e);
		return serviceError(e);
	}
};
