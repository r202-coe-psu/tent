import { describe, expect, it } from 'vitest';
import {
	CLIENT_DESCRIPTION_MAX_LENGTH,
	CLIENT_NAME_MAX_LENGTH,
	DEFAULT_SCOPES_BY_MODULE,
	createThirdPartyClientSchema,
	normalizeDeletedThirdPartyClient,
	normalizeRevealedSecret,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	partnerModuleLabel,
	revealThirdPartyClientSecretSchema,
	thirdPartyClientDisplayName,
	updateThirdPartyClientScopesSchema,
	type ThirdPartyClient
} from './third-party-client';

describe('createThirdPartyClientSchema', () => {
	it('requires name, module_name, and at least one scope', () => {
		const result = createThirdPartyClientSchema.safeParse({
			name: '',
			module_name: '',
			allowed_scopes: []
		});
		expect(result.success).toBe(false);
	});

	it('accepts a valid grantable scope selection and trims name/description', () => {
		const result = createThirdPartyClientSchema.safeParse({
			name: '  EOC Songkhla  ',
			description: '  Command center feed  ',
			module_name: 'M6',
			allowed_scopes: ['location-read', 'location-stock-read']
		});
		expect(result.success).toBe(true);
		expect(result.data?.name).toBe('EOC Songkhla');
		expect(result.data?.description).toBe('Command center feed');
	});

	it('accepts free-text names with spaces, uppercase, and Thai', () => {
		expect(
			createThirdPartyClientSchema.safeParse({
				name: 'M6 คลังสินค้า Warehouse',
				module_name: 'M6',
				allowed_scopes: ['location-read']
			}).success
		).toBe(true);
	});

	it('rejects a whitespace-only name', () => {
		expect(
			createThirdPartyClientSchema.safeParse({
				name: '   ',
				module_name: 'M6',
				allowed_scopes: ['location-read']
			}).success
		).toBe(false);
	});

	it('rejects name/description over the max length', () => {
		const base = { module_name: 'M6', allowed_scopes: ['location-read'] };
		expect(
			createThirdPartyClientSchema.safeParse({
				...base,
				name: 'a'.repeat(CLIENT_NAME_MAX_LENGTH + 1)
			}).success
		).toBe(false);
		expect(
			createThirdPartyClientSchema.safeParse({
				...base,
				name: 'ok',
				description: 'a'.repeat(CLIENT_DESCRIPTION_MAX_LENGTH + 1)
			}).success
		).toBe(false);
	});

	it('treats a blank or missing description as null/absent', () => {
		const blank = createThirdPartyClientSchema.safeParse({
			name: 'EOC',
			description: '   ',
			module_name: 'M7',
			allowed_scopes: ['location-read']
		});
		expect(blank.data?.description).toBeNull();

		const missing = createThirdPartyClientSchema.safeParse({
			name: 'EOC',
			module_name: 'M7',
			allowed_scopes: ['location-read']
		});
		expect(missing.success).toBe(true);
		expect(missing.data?.description).toBeUndefined();
	});

	it('does not carry a client_id — it is generated server-side', () => {
		const result = createThirdPartyClientSchema.safeParse({
			client_id: 'm6-typed',
			name: 'EOC',
			module_name: 'M7',
			allowed_scopes: ['location-read']
		});
		expect(result.success).toBe(true);
		expect(result.data).not.toHaveProperty('client_id');
	});

	it('rejects a module name outside the known partner set', () => {
		const result = createThirdPartyClientSchema.safeParse({
			name: 'mystery-client',
			module_name: 'M9',
			allowed_scopes: ['location-read']
		});
		expect(result.success).toBe(false);
	});

	it('accepts occupancy-pii-read — grantable through this form per written approval', () => {
		const result = createThirdPartyClientSchema.safeParse({
			name: 'M7 Command Center',
			module_name: 'M7',
			allowed_scopes: ['occupancy-pii-read']
		});
		expect(result.success).toBe(true);
	});
});

describe('DEFAULT_SCOPES_BY_MODULE', () => {
	it('presets M6 to location + stock read', () => {
		expect(DEFAULT_SCOPES_BY_MODULE.M6).toEqual(['location-read', 'location-stock-read']);
	});

	it('presets M7 to location + stock + occupancy read', () => {
		expect(DEFAULT_SCOPES_BY_MODULE.M7).toEqual([
			'location-read',
			'location-stock-read',
			'occupancy-read'
		]);
	});

	it('never presets the PII scope', () => {
		for (const scopes of Object.values(DEFAULT_SCOPES_BY_MODULE)) {
			expect(scopes).not.toContain('occupancy-pii-read');
		}
	});
});

describe('display helpers', () => {
	const base: ThirdPartyClient = {
		id: '1',
		client_id: 'tpc_abc',
		name: 'EOC Songkhla',
		description: null,
		module_name: 'M7',
		allowed_scopes: ['location-read'],
		is_active: true,
		deleted_at: null,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z'
	};

	it('uses name when present', () => {
		expect(thirdPartyClientDisplayName(base)).toBe('EOC Songkhla');
	});

	it('falls back to client_id for legacy clients without a name', () => {
		expect(thirdPartyClientDisplayName({ ...base, client_id: 'm6-warehouse', name: null })).toBe(
			'm6-warehouse'
		);
	});

	it('labels known modules and passes unknown ones through', () => {
		expect(partnerModuleLabel('M6')).toBe('M6 (จัดการทรัพยากร)');
		expect(partnerModuleLabel('M7')).toBe('M7 (EoC)');
		expect(partnerModuleLabel('M9')).toBe('M9');
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
			client_id: 'tpc_abc',
			name: 'M6 Warehouse',
			description: null,
			module_name: 'M6',
			allowed_scopes: ['location-read'],
			is_active: false,
			deleted_at: null,
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
			client_id: 'tpc_abc',
			name: 'M6 Warehouse',
			description: null,
			module_name: 'M6',
			allowed_scopes: ['location-read'],
			is_active: true,
			deleted_at: null,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z'
		};
		expect(normalizeRevokedThirdPartyClient(thirdPartyClient)).toEqual(thirdPartyClient);
	});
});

describe('normalizeDeletedThirdPartyClient', () => {
	it('is the same normalizer as revoke — { success, client } shape', () => {
		const thirdPartyClient = {
			id: '1',
			client_id: 'tpc_abc',
			name: 'M6 Warehouse',
			description: null,
			module_name: 'M6',
			allowed_scopes: ['location-read'],
			is_active: false,
			deleted_at: '2026-07-01T00:00:00.000Z',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-07-01T00:00:00.000Z'
		};
		expect(normalizeDeletedThirdPartyClient({ success: true, client: thirdPartyClient })).toEqual(
			thirdPartyClient
		);
	});
});

describe('normalizeRevealedSecret', () => {
	it('extracts client_secret from the response', () => {
		expect(normalizeRevealedSecret({ client_secret: 'tps_abc123' })).toBe('tps_abc123');
	});

	it('throws on an unexpected shape', () => {
		expect(() => normalizeRevealedSecret({})).toThrow();
		expect(() => normalizeRevealedSecret(null)).toThrow();
		expect(() => normalizeRevealedSecret({ client_secret: '' })).toThrow();
	});
});

describe('updateThirdPartyClientScopesSchema', () => {
	it('requires at least one scope', () => {
		expect(updateThirdPartyClientScopesSchema.safeParse({ allowed_scopes: [] }).success).toBe(
			false
		);
	});

	it('accepts a valid scope list', () => {
		const result = updateThirdPartyClientScopesSchema.safeParse({
			allowed_scopes: ['location-read', 'occupancy-pii-read']
		});
		expect(result.success).toBe(true);
	});

	it('rejects a scope outside the grantable set', () => {
		expect(
			updateThirdPartyClientScopesSchema.safeParse({ allowed_scopes: ['not-a-scope'] }).success
		).toBe(false);
	});
});

describe('revealThirdPartyClientSecretSchema', () => {
	it('requires a non-empty password', () => {
		expect(revealThirdPartyClientSecretSchema.safeParse({ password: '' }).success).toBe(false);
		expect(revealThirdPartyClientSecretSchema.safeParse({}).success).toBe(false);
	});

	it('accepts any non-empty password', () => {
		expect(revealThirdPartyClientSecretSchema.safeParse({ password: 'x' }).success).toBe(true);
	});
});
