import { serviceFetch } from '$lib/api/service';
import type { Announcement } from '../domain/announcement';

const BASE = '/api/back-office/announcements';

export function listAnnouncements(): Promise<Announcement[]> {
	return serviceFetch<Announcement[]>(BASE);
}

export function getAnnouncement(id: string): Promise<Announcement> {
	return serviceFetch<Announcement>(`${BASE}/${encodeURIComponent(id)}`);
}

export function createAnnouncement(
	data: Pick<
		Announcement,
		'title' | 'description' | 'title_en' | 'description_en' | 'severity' | 'is_active'
	>
): Promise<{ ok: boolean; id: string; rev: string; doc: Announcement }> {
	return serviceFetch(`${BASE}`, {
		method: 'POST',
		body: JSON.stringify(data),
		headers: { 'content-type': 'application/json' }
	});
}

export function updateAnnouncement(
	id: string,
	data: Partial<
		Pick<
			Announcement,
			'title' | 'description' | 'title_en' | 'description_en' | 'severity' | 'is_active'
		>
	>
): Promise<{ ok: boolean; id: string; rev: string; doc: Announcement }> {
	return serviceFetch(`${BASE}/${encodeURIComponent(id)}`, {
		method: 'PUT',
		body: JSON.stringify(data),
		headers: { 'content-type': 'application/json' }
	});
}

export function deleteAnnouncement(id: string): Promise<{ ok: boolean }> {
	return serviceFetch(`${BASE}/${encodeURIComponent(id)}`, {
		method: 'DELETE'
	});
}
