import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite } from '$lib/server/couch-admin';
import { getFooterLogoImage } from '$lib/server/public-portal/footer-logos.server';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

const fail = (status: number, code: string, message: string) =>
	json({ error: { code, message } }, { status, headers: noStoreHeaders });

/** Only SA may preview hidden logos — System Management is SA-only (CR-184 FR-14a / Q6). */
const canPreview = (cookie: string | null) =>
	authorizeUserWrite(cookie).then(
		(caller) => caller.isSA,
		() => false
	);

/**
 * Footer partner logo bytes (CR-184 FR-14). Published logos are public and cacheable — the URL
 * carries `?v={digest}` so a replaced image gets a new URL. Hiding a logo does not change that
 * URL, so `max-age` bounds how long a hidden logo can still show from cache (Q9).
 */
export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const published = await getFooterLogoImage(params.id);
		if (published) {
			return new Response(published.bytes, {
				status: 200,
				headers: {
					'content-type': published.contentType,
					'cache-control': 'public, max-age=3600',
					'x-content-type-options': 'nosniff'
				}
			});
		}

		if (await canPreview(request.headers.get('cookie'))) {
			const hidden = await getFooterLogoImage(params.id, { includeUnpublished: true });
			if (hidden) {
				return new Response(hidden.bytes, {
					status: 200,
					headers: {
						'content-type': hidden.contentType,
						'x-content-type-options': 'nosniff',
						...noStoreHeaders
					}
				});
			}
		}

		return fail(404, 'NOT_FOUND', 'ไม่พบรูปโลโก้');
	} catch {
		return fail(503, 'DEPENDENCY_UNAVAILABLE', 'บริการรูปโลโก้ไม่พร้อมใช้งาน');
	}
};
