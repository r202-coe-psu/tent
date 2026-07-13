import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	createProvince,
	createDistrict,
	createSubdistrict,
	updateSubdistrictZipcode,
	deleteLocation
} from '$lib/server/thailand-location';

/**
 * Dev-only admin API for Thailand location reference data (CR-037). SA-only.
 * Registry docs use deterministic name-derived `_id`s, so rename is not an
 * in-place update — the UI creates + deletes instead. Editable field: subdistrict
 * `zipcode`. Deletes are guarded: a province/district with descendants is rejected.
 */
export const prerender = false;

interface CreateBody {
	level: 'province' | 'district' | 'subdistrict';
	name: string;
	province?: string;
	district?: string;
	zipcode?: number;
}

/** POST — create a province / district / subdistrict. */
export const POST: RequestHandler = async ({ request }) => {
	const by = await requireAdmin(request.headers.get('cookie'));
	try {
		const body = (await request.json()) as CreateBody;
		switch (body.level) {
			case 'province':
				await createProvince(body.name, by);
				break;
			case 'district':
				await createDistrict(body.province ?? '', body.name, by);
				break;
			case 'subdistrict':
				await createSubdistrict(
					body.province ?? '',
					body.district ?? '',
					body.name,
					Number(body.zipcode),
					by
				);
				break;
			default:
				throw new ServiceError('VALIDATION', 'level ไม่ถูกต้อง');
		}
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};

/** PUT — update a subdistrict zipcode. Body: `{ id, zipcode }`. */
export const PUT: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const { id, zipcode } = (await request.json()) as { id: string; zipcode: number };
		if (!id) throw new ServiceError('VALIDATION', 'ต้องระบุ id');
		await updateSubdistrictZipcode(id, Number(zipcode));
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};

/** DELETE — remove a location doc by `?id=`. */
export const DELETE: RequestHandler = async ({ url, request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const id = url.searchParams.get('id');
		if (!id) throw new ServiceError('VALIDATION', 'ต้องระบุ id');
		await deleteLocation(id);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
