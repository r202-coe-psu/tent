import {
	faceFrameReplySchema,
	faceStartReplySchema,
	faceVerifyReplySchema,
	type FaceCheckFlow,
	type FaceFrameReply,
	type FaceStartReply,
	type FaceVerifyReply
} from '../domain/face-check';

export const KIOSK_FACE_PATH = '/api/v1/scanner/kiosk/face';
export const KIOSK_FACE_FRAME_TIMEOUT_MS = 8_000;
/** `verify` may wait for the chip photo to be read (up to 20 s on the scanner client). */
export const KIOSK_FACE_VERIFY_TIMEOUT_MS = 35_000;
export const KIOSK_FACE_START_TIMEOUT_MS = 10_000;

/** The scanner client refused or could not answer; `code` is its error code when it sent one. */
export class KioskFaceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null
	) {
		super(`face check request failed (${status})`);
		this.name = 'KioskFaceError';
	}
}

export type KioskFaceApi = {
	start(citizenId: string, flow: FaceCheckFlow): Promise<FaceStartReply>;
	frame(jpeg: Blob): Promise<FaceFrameReply>;
	verify(frames: readonly Blob[]): Promise<FaceVerifyReply>;
	/**
	 * Best effort: wipes what the scanner client holds for this person. Never throws. `reason` is
	 * one of the scanner client's allowed codes (camera_denied, ..., user_skipped), for its log only.
	 */
	cancel(reason?: string): Promise<void>;
};

export async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
	}
	return btoa(binary);
}

/**
 * Wipes what the scanner client holds for the person at the kiosk (chip photo, check result).
 * Pages call it when they let the person go; it never throws.
 */
export function cancelKioskFaceCheck(reason?: string): Promise<void> {
	return createKioskFaceApi().cancel(reason);
}

/**
 * Talks to the scanner client on this kiosk (it answers `/face/*` itself; nothing reaches the
 * server). Frames go up as JPEG; only a verdict or a hint comes back - never a score or an image.
 */
export function createKioskFaceApi(fetchFn: typeof fetch = fetch): KioskFaceApi {
	async function post(
		action: string,
		body: BodyInit,
		contentType: string,
		timeoutMs: number
	): Promise<unknown> {
		const response = await fetchFn(`${KIOSK_FACE_PATH}/${action}`, {
			method: 'POST',
			cache: 'no-store',
			headers: { 'content-type': contentType },
			body,
			signal: AbortSignal.timeout(timeoutMs)
		});
		const payload: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
			throw new KioskFaceError(response.status, typeof code === 'string' ? code : null);
		}
		return payload;
	}

	function parse<T>(schema: { parse: (value: unknown) => T }, payload: unknown): T {
		try {
			return schema.parse(payload);
		} catch {
			throw new KioskFaceError(502, 'INVALID_FACE_REPLY');
		}
	}

	return {
		async start(citizenId, flow) {
			const payload = await post(
				'start',
				JSON.stringify({ citizen_id: citizenId, flow }),
				'application/json',
				KIOSK_FACE_START_TIMEOUT_MS
			);
			return parse(faceStartReplySchema, payload);
		},
		async frame(jpeg) {
			const payload = await post('frame', jpeg, 'image/jpeg', KIOSK_FACE_FRAME_TIMEOUT_MS);
			return parse(faceFrameReplySchema, payload);
		},
		async verify(frames) {
			const encoded = await Promise.all(frames.map(blobToBase64));
			const payload = await post(
				'verify',
				JSON.stringify({ frames: encoded }),
				'application/json',
				KIOSK_FACE_VERIFY_TIMEOUT_MS
			);
			return parse(faceVerifyReplySchema, payload);
		},
		async cancel(reason) {
			try {
				await post(
					'cancel',
					JSON.stringify(reason ? { reason } : {}),
					'application/json',
					KIOSK_FACE_START_TIMEOUT_MS
				);
			} catch {
				// Nothing to do: the scanner client also wipes it on the next card and after 5 minutes.
			}
		}
	};
}
