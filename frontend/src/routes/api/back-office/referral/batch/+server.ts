/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
import {
	createM5Batch,
	M5BatchError,
	submitM5Batch
} from '$lib/features/referrals/server/referral.m5.server';
import { IntegrationError } from '$lib/server/integrations';
import { assertReferralTypeAllowed, authorizeReferral, resolveShelterCode } from '../_auth';
import { batchContext, m5ErrorResponse } from '../_m5';

export const prerender = false;

const BACK_OFFICE_SCOPE = 'internal' as const;

/**
 * POST /api/back-office/referral/batch — create one M5 batch as drafts (FR-B1–B3).
 *
 * Body: `m5BatchInputSchema`. With `submit: true` the batch is sent to M5 right after it is
 * created; a failed send keeps the drafts and reports it in `submit` (201 either way).
 * → `{ batch_id, items, submit: null | { ok: true, code, status, failed } | { ok: false, error, code } }`
 */
export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeReferral(
			request.headers.get('cookie'),
			url.searchParams.get('shelter_code')
		);
		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));
		assertReferralTypeAllowed(caller, shelterCode, 'medical-emergency');

		const ctx = batchContext(caller, shelterCode);
		const body = await request.json().catch(() => ({}));
		const created = await createM5Batch(
			{ ...ctx, hasActiveReferral: (id) => ctx.repo.hasActiveReferral(id) },
			body
		);

		let submit: Record<string, unknown> | null = null;
		let items = created.referrals;
		if (created.input.submit) {
			try {
				const sent = await submitM5Batch(ctx, created.batchId);
				const byId = new Map(sent.referrals.map((r) => [r._id, r]));
				items = items.map((r) => byId.get(r._id) ?? r);
				submit = {
					ok: true,
					code: sent.transfer.code,
					status: sent.transfer.status,
					failed: sent.failed
				};
			} catch (e: unknown) {
				if (!(e instanceof M5BatchError || e instanceof IntegrationError)) throw e;
				submit = { ok: false, error: e.message, code: e.code, ...e.extra };
			}
		}

		return json(
			{
				batch_id: created.batchId,
				items: items.map((r) => redactForScope(r, BACK_OFFICE_SCOPE)),
				submit
			},
			{ status: 201, headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (e: unknown) {
		return m5ErrorResponse(e, 'Referral batch POST');
	}
};
