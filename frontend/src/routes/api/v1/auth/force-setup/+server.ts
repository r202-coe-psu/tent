import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import { setupSecurityQuestionAndResetPassword } from '$lib/server/user-service';
import { getSession } from '$lib/db/couch';

export const prerender = false;

/** POST { new_password?, security_question: { question_id, answer } } — First-time / forced security setup */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
		}

		const body = (await request.json().catch(() => ({}))) as {
			new_password?: unknown;
			security_question?: { question_id?: unknown; answer?: unknown };
		};

		const new_password =
			typeof body.new_password === 'string' && body.new_password.length > 0
				? body.new_password
				: undefined;
		const question_id =
			typeof body.security_question?.question_id === 'string'
				? body.security_question.question_id.trim()
				: '';
		const raw_answer =
			typeof body.security_question?.answer === 'string'
				? body.security_question.answer.trim()
				: '';

		if (!question_id || !raw_answer) {
			throw new ServiceError('VALIDATION', 'Security question and answer are required');
		}

		await setupSecurityQuestionAndResetPassword({
			username: session.name,
			new_password,
			question_id,
			raw_answer
		});

		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
