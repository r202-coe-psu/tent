import { describe, it, expect, vi } from 'vitest';
import {
	ReferralConflictError,
	TRANSITION_MAX_RETRIES,
	transitionWithRetry,
	type TransitionRepo
} from './referral.transition-retry';
import type { Referral } from '../domain/referral.schema';

const doc = { _id: 'referral:1', status: 'sent' } as unknown as Referral;

function repoWith(transition: TransitionRepo['transition']): TransitionRepo {
	return { transition };
}

describe('transitionWithRetry', () => {
	it('returns the updated referral and forwards every argument', async () => {
		const transition = vi.fn().mockResolvedValue(doc);
		const result = await transitionWithRetry(
			repoWith(transition),
			'referral:1',
			'closed',
			'sm',
			'why',
			'SH001'
		);
		expect(result).toBe(doc);
		expect(transition).toHaveBeenCalledWith('referral:1', 'closed', 'sm', 'why', 'SH001');
	});

	it('retries a 409 and succeeds on the next attempt', async () => {
		const transition = vi
			.fn()
			.mockRejectedValueOnce({ status: 409, message: 'Conflict' })
			.mockResolvedValueOnce(doc);
		await expect(
			transitionWithRetry(repoWith(transition), 'referral:1', 'sent', 'sm', undefined, 'SH001')
		).resolves.toBe(doc);
		expect(transition).toHaveBeenCalledTimes(2);
	});

	it('throws ReferralConflictError after the max attempts', async () => {
		const transition = vi.fn().mockRejectedValue({ status: 409, message: 'Conflict' });
		const err = await transitionWithRetry(
			repoWith(transition),
			'referral:1',
			'sent',
			'sm',
			undefined,
			'SH001'
		).catch((e) => e);
		expect(err).toBeInstanceOf(ReferralConflictError);
		expect(err.status).toBe(409);
		expect(transition).toHaveBeenCalledTimes(TRANSITION_MAX_RETRIES);
	});

	it('rethrows a non-conflict error at once without retrying', async () => {
		const transition = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
		await expect(
			transitionWithRetry(repoWith(transition), 'referral:1', 'closed', 'sm', undefined, 'SH002')
		).rejects.toMatchObject({ status: 403 });
		expect(transition).toHaveBeenCalledTimes(1);
	});
});
