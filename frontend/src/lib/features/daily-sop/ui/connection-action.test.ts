import { describe, expect, it } from 'vitest';
import { shouldShowDailySopReconnect } from './connection-action';

describe('Daily SOP reconnect action', () => {
	it('appears only after the connection is disconnected', () => {
		expect(shouldShowDailySopReconnect('connected')).toBe(false);
		expect(shouldShowDailySopReconnect('connecting')).toBe(false);
		expect(shouldShowDailySopReconnect('disconnected')).toBe(true);
	});
});
