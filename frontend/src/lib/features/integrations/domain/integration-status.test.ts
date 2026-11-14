import { describe, expect, it } from 'vitest';
import {
	INTEGRATION_GATE_MESSAGES,
	blockedStateOf,
	isGateReady,
	type BlockedState,
	type IntegrationState
} from './integration-status';

describe('integration gate helpers', () => {
	it('is ready only for `ready`', () => {
		expect(isGateReady('ready')).toBe(true);
		expect(isGateReady(undefined)).toBe(false);
		expect(isGateReady('central_unreachable')).toBe(false);
		expect(isGateReady('m6_credential_invalid')).toBe(false);
	});

	it('returns the blocked state, or null while ready or unknown', () => {
		expect(blockedStateOf('m6_unavailable')).toBe('m6_unavailable');
		expect(blockedStateOf('ready')).toBeNull();
		expect(blockedStateOf(undefined)).toBeNull();
	});

	it('has a Thai message for every blocked state', () => {
		const states: BlockedState[] = [
			'central_unreachable',
			'm5_unavailable',
			'm5_not_configured',
			'm5_credential_invalid',
			'm6_unavailable',
			'm6_not_configured',
			'm6_credential_invalid'
		];
		for (const s of states) expect(INTEGRATION_GATE_MESSAGES[s]).toMatch(/[ก-๙]/);
		const all: IntegrationState[] = ['ready', ...states];
		expect(all).toHaveLength(8);
		expect(INTEGRATION_GATE_MESSAGES.central_unreachable).toBe('เชื่อมต่อกับระบบกลางไม่ได้');
	});
});
