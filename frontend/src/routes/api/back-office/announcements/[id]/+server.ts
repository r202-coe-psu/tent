import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	getAnnouncement,
	saveAnnouncement,
	deleteAnnouncement
} from '$lib/server/announcements-server';
import { touchAnnouncement } from '$lib/features/announcements';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'));
		const doc = await getAnnouncement(params.id);
		if (!doc) {
			throw new ServiceError('VALIDATION', 'Announcement not found');
		}
		return json(doc);
	} catch (e) {
		return serviceError(e);
	}
};

export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can edit announcements');
		}

		const body = await request.json();
		const doc = await getAnnouncement(params.id);
		if (!doc) {
			throw new ServiceError('VALIDATION', 'Announcement not found');
		}

		const updatedDoc = touchAnnouncement(doc, {
			title: body.title ?? doc.title,
			description: body.description ?? doc.description,
			severity: body.severity ?? doc.severity,
			is_active: body.is_active ?? doc.is_active
		});

		const result = await saveAnnouncement(updatedDoc);
		return json({ ok: true, id: updatedDoc._id, rev: result.rev, doc: updatedDoc });
	} catch (e) {
		return serviceError(e);
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can delete announcements');
		}

		const doc = await getAnnouncement(params.id);
		if (!doc) {
			throw new ServiceError('VALIDATION', 'Announcement not found');
		}
		if (!doc._rev) {
			throw new ServiceError('VALIDATION', 'Missing document revision');
		}

		const result = await deleteAnnouncement(params.id, doc._rev);
		return json(result);
	} catch (e) {
		return serviceError(e);
	}
};
