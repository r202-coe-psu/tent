import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isActiveAt } from '$lib/features/kiosk-banners';
import { getBanner, getBannerImage } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { verifyBannerImageSig } from '$lib/server/kiosk-banners/signed-image-url';
import { DEPENDENCY_UNAVAILABLE } from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

const fail = (status: number, code: string, message: string) =>
	json({ error: { code, message } }, { status, headers: noStoreHeaders });

const notFound = () => fail(404, 'NOT_FOUND', 'ไม่พบรูปแบนเนอร์');

/** Signed-URL image bytes for an active banner; no device headers (FR-KBN-33/34, FR-KBR-33). */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const now = new Date();
		const exp = url.searchParams.get('exp');
		const valid = verifyBannerImageSig(params.id, exp, url.searchParams.get('sig'), now.getTime());
		if (!valid) return fail(403, 'INVALID_SIGNATURE', 'ลายเซ็นของลิงก์รูปไม่ถูกต้องหรือหมดอายุ');

		const banner = await getBanner(params.id);
		if (!banner || !isActiveAt(banner, now)) return notFound();
		const image = await getBannerImage(params.id);
		if (!image) return notFound();

		// The attract loop re-shows the same signed URL every rotation; cache it only as long as
		// the signature lives, so a revoked banner drops off with the next poll's new URL.
		const maxAge = Math.max(0, Number(exp) - Math.ceil(now.getTime() / 1000));
		return new Response(image.bytes, {
			status: 200,
			headers: { 'content-type': image.contentType, 'cache-control': `private, max-age=${maxAge}` }
		});
	} catch {
		return fail(503, DEPENDENCY_UNAVAILABLE, 'บริการแบนเนอร์ kiosk ไม่พร้อมใช้งาน');
	}
};
