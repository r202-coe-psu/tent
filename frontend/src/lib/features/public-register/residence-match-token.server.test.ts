import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { signResidenceMatchToken, verifyResidenceMatchToken } from './residence-match-token.server';

describe('residence-match-token', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('round-trips a shelter token', () => {
		const token = signResidenceMatchToken({
			kind: 'shelter',
			shelterCode: 'SH001',
			householdId: 'household:abc'
		});
		const payload = verifyResidenceMatchToken(token);
		expect(payload).toEqual({
			kind: 'shelter',
			shelterCode: 'SH001',
			householdId: 'household:abc',
			exp: expect.any(Number)
		});
	});

	it('round-trips an unassigned token', () => {
		const token = signResidenceMatchToken({
			kind: 'unassigned',
			registrationId: '01HXYZ'
		});
		expect(verifyResidenceMatchToken(token)?.kind).toBe('unassigned');
		if (verifyResidenceMatchToken(token)?.kind === 'unassigned') {
			expect(verifyResidenceMatchToken(token)).toMatchObject({
				registrationId: '01HXYZ'
			});
		}
	});

	it('rejects forged or expired tokens', () => {
		const token = signResidenceMatchToken({
			kind: 'shelter',
			shelterCode: 'SH001',
			householdId: 'household:abc',
			exp: Math.floor(Date.now() / 1000) - 10
		});
		expect(verifyResidenceMatchToken(token)).toBeNull();
		expect(verifyResidenceMatchToken('not-a-token')).toBeNull();
		expect(verifyResidenceMatchToken(`${token.slice(0, 10)}.forged`)).toBeNull();
	});
});
