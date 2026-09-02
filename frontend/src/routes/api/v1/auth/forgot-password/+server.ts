import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	getSecurityQuestionChallenge,
	verifySecurityQuestionAndResetPassword
} from '$lib/server/user-service';

export const prerender = false;

/** GET ?phone=... — Retrieve security question challenge for a user */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const phone = url.searchParams.get('phone')?.trim() || '';
		if (!phone) {
			throw new ServiceError('VALIDATION', 'phone is required');
		}
		const result = await getSecurityQuestionChallenge(phone);
		return json({ ok: true, ...result });
	} catch (e) {
		return serviceError(e);
	}
};

/** POST { phone, question_id, answer, new_password } — Verify answer and reset password */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as {
			phone?: unknown;
			question_id?: unknown;
			answer?: unknown;
			new_password?: unknown;
		};

		const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
		const question_id = typeof body.question_id === 'string' ? body.question_id.trim() : '';
		const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
		const new_password = typeof body.new_password === 'string' ? body.new_password : '';

		if (!phone || !question_id || !answer || !new_password) {
			throw new ServiceError('VALIDATION', 'All fields are required');
		}

		await verifySecurityQuestionAndResetPassword(phone, question_id, answer, new_password);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
