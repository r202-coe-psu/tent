import { adminFetch, adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { Announcement } from '$lib/features/announcements';

const REGISTRY_DB = 'registry';

export async function listAnnouncements(): Promise<Announcement[]> {
	const res = await adminFetch<{ docs: Announcement[] }>(`/${REGISTRY_DB}/_find`, {
		method: 'POST',
		body: JSON.stringify({
			selector: { type: 'announcement' }
		})
	});
	return res.docs.sort(
		(a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
	);
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read announcement ${id}`);
	}
	return res.data as Announcement;
}

export async function saveAnnouncement(doc: Announcement): Promise<{ ok: true; rev: string }> {
	const res = await adminFetch<{ ok: boolean; rev: string; id: string }>(
		`/${REGISTRY_DB}/${encodeURIComponent(doc._id)}`,
		{
			method: 'PUT',
			body: JSON.stringify(doc)
		}
	);
	return { ok: true, rev: res.rev };
}

export async function deleteAnnouncement(id: string, rev: string): Promise<{ ok: true }> {
	await adminFetch(`/${REGISTRY_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, {
		method: 'DELETE'
	});
	return { ok: true };
}
