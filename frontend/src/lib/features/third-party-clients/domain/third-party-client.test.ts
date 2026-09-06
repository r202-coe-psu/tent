import { describe, expect, it } from 'vitest';
import {
	createThirdPartyClientSchema,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList
} from './third-party-client';

describe('createThirdPartyClientSchema', () => {
	it('requires client_id, module_name, and at least one scope', () => {
		const result = createThirdPartyClientSchema.safeParse({
			client_id: '',
			module_name: '',
			allowed_scopes: []
		});
		expect(result.success).toBe(false);
	});

	it('accepts a valid grantable scope selection', () => {
		const result = createThirdPartyClientSchema.safeParse({
			client_id: 'm6-warehouse-logistics',
			module_name: 'M6',
			allowed_scopes: ['location-read', 'location-stock-read']
		});
		expect(result.success).toBe(true);
	});

	it('rejects client_id with spaces or uppercase', () => {
		expect(
			createThirdPartyClientSchema.safeParse({
				client_id: 'M6 Warehouse',
				module_name: 'M6',
				allowed_scopes: ['location-read']
			}).success
		).toBe(false);
	});

	it('rejects a module name outside the known partner set', () => {
		const result = createThirdPartyClientSchema.safeParse({
			client_id: 'mystery-client',
			module_name: 'M9',
			allowed_scopes: ['location-read']
		});
		expect(result.success).toBe(false);
	});

	it('rejects occupancy-pii-read — never grantable through this form', () => {
		const result = createThirdPartyClientSchema.safeParse({
			client_id: 'm7-command-center',
			module_name: 'M7',
			allowed_scopes: ['occupancy-pii-read']
		});
		expect(result.success).toBe(false);
	});
});

describe('normalizeThirdPartyClientList', () => {
	it('accepts a bare array', () => {
		expect(normalizeThirdPartyClientList([{ id: '1' }])).toEqual([{ id: '1' }]);
	});

	it('unwraps FastAPI clients wrapper (preferred)', () => {
		expect(normalizeThirdPartyClientList({ clients: [{ id: 'k' }], count: 1 })).toEqual([
			{ id: 'k' }
		]);
	});

	it('unwraps items / data wrappers', () => {
		expect(normalizeThirdPartyClientList({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
		expect(normalizeThirdPartyClientList({ data: [{ id: 'c' }] })).toEqual([{ id: 'c' }]);
	});

	it('returns empty array for unknown shapes', () => {
		expect(normalizeThirdPartyClientList(null)).toEqual([]);
		expect(normalizeThirdPartyClientList({})).toEqual([]);
	});
});

describe('normalizeRevokedThirdPartyClient', () => {
	it('unwraps { success, client }', () => {
		const thirdPartyClient = {
			id: '1',
			client_id: 'm6-warehouse-logistics',
			module_name: 'M6',
			allowed_scopes: ['location-read'],
			is_active: false,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-06-01T00:00:00.000Z'
		};
		expect(normalizeRevokedThirdPartyClient({ success: true, client: thirdPartyClient })).toEqual(
			thirdPartyClient
		);
	});

	it('accepts a bare client object', () => {
		const thirdPartyClient = {
			id: '1',
			client_id: 'm6-warehouse-logistics',
			module_name: 'M6',
			allowed_scopes: ['location-read'],
			is_active: true,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z'
		};
		expect(normalizeRevokedThirdPartyClient(thirdPartyClient)).toEqual(thirdPartyClient);
	});
});
