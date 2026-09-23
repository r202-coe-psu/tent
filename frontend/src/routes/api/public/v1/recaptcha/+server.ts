import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRecaptchaClientEnabled } from '$lib/server/security/recaptcha-gate';

export const prerender = false;

/**
 * GET /api/public/v1/recaptcha — whether the browser should load/execute reCAPTCHA.
 * `enabled` is true only when keys are configured and config:app.recaptcha_enabled is ON.
 */
export const GET: RequestHandler = async () => {
	const enabled = await isRecaptchaClientEnabled();
	return json({ enabled }, { headers: { 'Cache-Control': 'no-store' } });
};
