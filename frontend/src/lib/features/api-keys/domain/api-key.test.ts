import { describe, expect, it } from 'vitest';
import {
	apiKeyStatus,
	createApiKeySchema,
	normalizeApiKeyList,
	normalizeRevokedApiKey,
	resolveExpiresAt
} from './api-key';

describe('apiKeyStatus', () => {
	const now = new Date('2026-06-15T12:00:00.000Z');

	it('returns revoked when revoked_at is set', () => {
		expect(
			apiKeyStatus(
				{ expires_at: '2027-01-01T00:00:00.000Z', revoked_at: '2026-06-01T00:00:00.000Z' },
				now
			)
		).toBe('revoked');
	});

	it('returns expired when past expires_at and not revoked', () => {
		expect(apiKeyStatus({ expires_at: '2026-01-01T00:00:00.000Z', revoked_at: null }, now)).toBe(
			'expired'
		);
	});

	it('returns active when not revoked and before expiry', () => {
		expect(apiKeyStatus({ expires_at: '2027-01-01T00:00:00.000Z', revoked_at: null }, now)).toBe(
			'active'
		);
	});
});

describe('resolveExpiresAt', () => {
	const now = new Date('2026-01-01T00:00:00.000Z');

	it('adds days in UTC', () => {
		expect(resolveExpiresAt({ name: 'a', owner: 'b', duration_days: 30 }, now)).toBe(
			'2026-01-31T00:00:00.000Z'
		);
	});

	it('supports 60-day durations', () => {
		expect(resolveExpiresAt({ name: 'a', owner: 'b', duration_days: 60 }, now)).toBe(
			'2026-03-02T00:00:00.000Z'
		);
	});
});

describe('createApiKeySchema', () => {
	it('requires name, owner, and duration_days', () => {
		const result = createApiKeySchema.safeParse({ name: '', owner: '' });
		expect(result.success).toBe(false);
	});

	it('accepts a preset duration', () => {
		const result = createApiKeySchema.safeParse({
			name: 'ROD',
			owner: 'Hat Yai',
			duration_days: 90
		});
		expect(result.success).toBe(true);
	});

	it('accepts a custom day count', () => {
		const result = createApiKeySchema.safeParse({
			name: 'ROD',
			owner: 'Hat Yai',
			duration_days: 45
		});
		expect(result.success).toBe(true);
	});

	it('rejects zero or negative days', () => {
		expect(
			createApiKeySchema.safeParse({ name: 'ROD', owner: 'Hat Yai', duration_days: 0 }).success
		).toBe(false);
	});
});

describe('normalizeApiKeyList', () => {
	it('accepts a bare array', () => {
		expect(normalizeApiKeyList([{ id: '1' }])).toEqual([{ id: '1' }]);
	});

	it('unwraps FastAPI keys wrapper (preferred)', () => {
		expect(normalizeApiKeyList({ keys: [{ id: 'k' }], count: 1 })).toEqual([{ id: 'k' }]);
	});

	it('unwraps items / api_keys / data wrappers', () => {
		expect(normalizeApiKeyList({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
		expect(normalizeApiKeyList({ api_keys: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
		expect(normalizeApiKeyList({ data: [{ id: 'c' }] })).toEqual([{ id: 'c' }]);
	});

	it('returns empty array for unknown shapes', () => {
		expect(normalizeApiKeyList(null)).toEqual([]);
		expect(normalizeApiKeyList({})).toEqual([]);
	});
});

describe('normalizeRevokedApiKey', () => {
	it('unwraps { success, key }', () => {
		const key = {
			id: '1',
			name: 'n',
			owner: 'o',
			key_prefix: 'tsk_xxxx',
			expires_at: '2027-01-01T00:00:00.000Z',
			created_by: 'admin',
			created_at: '2026-01-01T00:00:00.000Z',
			revoked_at: '2026-06-01T00:00:00.000Z'
		};
		expect(normalizeRevokedApiKey({ success: true, key })).toEqual(key);
	});

	it('accepts a bare key object', () => {
		const key = {
			id: '1',
			name: 'n',
			owner: 'o',
			key_prefix: 'tsk_xxxx',
			expires_at: '2027-01-01T00:00:00.000Z',
			created_by: 'admin',
			created_at: '2026-01-01T00:00:00.000Z',
			revoked_at: null
		};
		expect(normalizeRevokedApiKey(key)).toEqual(key);
	});
});
