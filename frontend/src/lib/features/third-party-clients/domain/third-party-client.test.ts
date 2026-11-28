import { describe, expect, it } from 'vitest';
import {
	CLIENT_DESCRIPTION_MAX_LENGTH,
	CLIENT_NAME_MAX_LENGTH,
	DEFAULT_SCOPES_BY_MODULE,
	GRANTABLE_SCOPES,
	SCOPE_LABEL,
	SCOPE_SHORT_LABEL,
	SENSITIVE_SCOPES,
	SENSITIVE_SCOPE_WARNING,
	clientHasSensitiveScope,
	createThirdPartyClientSchema,
	filterThirdPartyClients,
	isSensitiveScope,
	normalizeDeletedThirdPartyClient,
	normalizeRevealedSecret,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	partnerModuleLabel,
	revealThirdPartyClientSecretSchema,
	scopeShortLabel,
	thirdPartyClientDisplayName,
	updateThirdPartyClientScopesSchema,
	type ThirdPartyClient,
	type ThirdPartyClientListFilter
} from './third-party-client';

describe('createThirdPartyClientSchema', () => {
	it('treats module_name as optional — blank or missing becomes null (CR-154 FR-62)', () => {
		const blank = createThirdPartyClientSchema.safeParse({
			name: 'No module',
			module_name: '',
			allowed_scopes: ['location-read']
		});
		expect(blank.success).toBe(true);
		expect(blank.data?.module_name).toBeNull();

		const missing = createThirdPartyClientSchema.safeParse({
			name: 'No module',
			allowed_scopes: ['location-read']
		});
		expect(missing.success).toBe(true);
		expect(missing.data?.module_name ?? null).toBeNull();
	});

	it('still rejects an unknown module', () => {
		expect(
			createThirdPartyClientSchema.safeParse({
				name: 'Mystery',
				module_name: 'M9',
				allowed_scopes: ['location-read']
			}).success
		).toBe(false);
	});

	it('requires name and at least one scope', () => {
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

	it('never presets a sensitive scope', () => {
		for (const scopes of Object.values(DEFAULT_SCOPES_BY_MODULE)) {
			for (const sensitive of SENSITIVE_SCOPES) expect(scopes).not.toContain(sensitive);
		}
	});

	it('presets M2 to location-read only (CR-154)', () => {
		expect(DEFAULT_SCOPES_BY_MODULE.M2).toEqual(['location-read']);
	});
});

describe('CR-154 M2 scopes', () => {
	it('accepts an M2 client with booking-write and residency-read', () => {
		const result = createThirdPartyClientSchema.safeParse({
			name: 'M2 Vulnerable Groups',
			module_name: 'M2',
			allowed_scopes: ['location-read', 'booking-write', 'residency-read']
		});
		expect(result.success).toBe(true);
	});

	it('flags booking-write and residency-read as sensitive with a warning each', () => {
		expect(SENSITIVE_SCOPES).toContain('booking-write');
		expect(SENSITIVE_SCOPES).toContain('residency-read');
		for (const scope of SENSITIVE_SCOPES) expect(SENSITIVE_SCOPE_WARNING[scope]).toBeTruthy();
	});
});

describe('#736 occupant-search scope (EXT-012)', () => {
	const SCOPE = 'occupant-search';

	it('is grantable and has a label', () => {
		expect(GRANTABLE_SCOPES as readonly string[]).toContain(SCOPE);
		expect((SCOPE_LABEL as Record<string, string>)[SCOPE]).toBeTruthy();
		expect(
			createThirdPartyClientSchema.safeParse({
				name: 'Search partner',
				module_name: '',
				allowed_scopes: ['location-read', SCOPE]
			}).success
		).toBe(true);
	});

	it('is sensitive and carries a warning', () => {
		expect(SENSITIVE_SCOPES as readonly string[]).toContain(SCOPE);
		expect((SENSITIVE_SCOPE_WARNING as Record<string, string>)[SCOPE]).toBeTruthy();
	});

	it('is not in any module preset — an admin ticks it case by case', () => {
		for (const scopes of Object.values(DEFAULT_SCOPES_BY_MODULE)) {
			expect(scopes as readonly string[]).not.toContain(SCOPE);
		}
	});
});

describe('#751 booking-bypass scope (EOC)', () => {
	const SCOPE = 'booking-bypass';

	it('is grantable and has a label', () => {
		expect(GRANTABLE_SCOPES as readonly string[]).toContain(SCOPE);
		expect((SCOPE_LABEL as Record<string, string>)[SCOPE]).toBeTruthy();
		expect(
			createThirdPartyClientSchema.safeParse({
				name: 'EOC partner',
				module_name: 'M2',
				allowed_scopes: ['booking-write', SCOPE]
			}).success
		).toBe(true);
	});

	it('is sensitive and carries a warning', () => {
		expect(SENSITIVE_SCOPES as readonly string[]).toContain(SCOPE);
		expect((SENSITIVE_SCOPE_WARNING as Record<string, string>)[SCOPE]).toBeTruthy();
	});

	// Not in any preset (M7 included): covered by 'never presets a sensitive scope' above, since
	// this scope is sensitive.
});

describe('CR-257 pii-full scope (unmasked EXT-007 / EXT-012)', () => {
	const SCOPE = 'pii-full';

	it('is grantable with a base scope and has a label; the grantable set is now nine scopes', () => {
		expect(GRANTABLE_SCOPES as readonly string[]).toContain(SCOPE);
		expect(GRANTABLE_SCOPES).toHaveLength(9);
		expect((SCOPE_LABEL as Record<string, string>)[SCOPE]).toBeTruthy();
		expect(
			createThirdPartyClientSchema.safeParse({
				name: 'EOC full data',
				module_name: 'M7',
				allowed_scopes: ['occupant-search', 'occupancy-pii-read', SCOPE]
			}).success
		).toBe(true);
	});

	it('is sensitive and carries a warning', () => {
		expect(SENSITIVE_SCOPES as readonly string[]).toContain(SCOPE);
		expect((SENSITIVE_SCOPE_WARNING as Record<string, string>)[SCOPE]).toBeTruthy();
	});

	it('is not in any module preset — an admin ticks it case by case', () => {
		for (const scopes of Object.values(DEFAULT_SCOPES_BY_MODULE)) {
			expect(scopes as readonly string[]).not.toContain(SCOPE);
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
		expect(partnerModuleLabel('M2')).toBe('M2 (กลุ่มเปราะบาง)');
		expect(partnerModuleLabel('M9')).toBe('M9');
		expect(partnerModuleLabel(null)).toBe('ไม่ระบุ');
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

function sampleClient(
	partial: Partial<ThirdPartyClient> & Pick<ThirdPartyClient, 'id'>
): ThirdPartyClient {
	return {
		client_id: `tpc_${partial.id}`,
		name: null,
		description: null,
		module_name: null,
		allowed_scopes: ['location-read'],
		is_active: true,
		deleted_at: null,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-02T00:00:00.000Z',
		...partial
	};
}

const openFilter: ThirdPartyClientListFilter = {
	query: '',
	status: 'all',
	sensitiveOnly: false
};

describe('scopeShortLabel', () => {
	it('has a short Thai label for every grantable scope', () => {
		for (const scope of GRANTABLE_SCOPES) {
			expect(SCOPE_SHORT_LABEL[scope].length).toBeGreaterThan(0);
			expect(scopeShortLabel(scope)).toBe(SCOPE_SHORT_LABEL[scope]);
			expect(scopeShortLabel(scope)).not.toBe(scope);
		}
	});

	it('falls back to the raw code for an unknown scope', () => {
		expect(scopeShortLabel('not-a-scope')).toBe('not-a-scope');
	});
});

describe('isSensitiveScope', () => {
	it('flags PDPA scopes and ignores operational and unknown codes', () => {
		expect(isSensitiveScope('occupancy-pii-read')).toBe(true);
		expect(isSensitiveScope('booking-write')).toBe(true);
		expect(isSensitiveScope('booking-bypass')).toBe(true);
		expect(isSensitiveScope('pii-full')).toBe(true);
		expect(isSensitiveScope('location-read')).toBe(false);
		expect(isSensitiveScope('occupancy-read')).toBe(false);
		expect(isSensitiveScope('not-a-scope')).toBe(false);
	});

	it('is true for a client when any allowed scope is sensitive', () => {
		expect(
			clientHasSensitiveScope(sampleClient({ id: 'ops', allowed_scopes: ['location-read'] }))
		).toBe(false);
		expect(
			clientHasSensitiveScope(
				sampleClient({ id: 'pii', allowed_scopes: ['location-read', 'pii-full'] })
			)
		).toBe(true);
	});
});

describe('filterThirdPartyClients', () => {
	const rows: ThirdPartyClient[] = [
		sampleClient({
			id: '1',
			client_id: 'tpc_eoc',
			name: 'EOC Songkhla',
			description: 'ศูนย์สั่งการ',
			module_name: 'M7',
			allowed_scopes: ['location-read', 'occupancy-read'],
			is_active: true
		}),
		sampleClient({
			id: '2',
			client_id: 'tpc_wh',
			name: 'คลัง M6',
			description: null,
			module_name: 'M6',
			allowed_scopes: ['location-stock-read'],
			is_active: false
		}),
		sampleClient({
			id: '3',
			client_id: 'tpc_pii',
			name: 'ค้นหาบุคคล',
			description: 'partner search',
			module_name: 'M2',
			allowed_scopes: ['occupant-search', 'pii-full'],
			is_active: true
		}),
		sampleClient({
			id: '4',
			client_id: 'tpc_book',
			name: 'จองแทน',
			description: 'booking desk',
			module_name: 'M2',
			allowed_scopes: ['booking-write'],
			is_active: false
		}),
		sampleClient({
			id: '5',
			client_id: 'tpc_bypass',
			name: 'ศูนย์ปิด',
			description: null,
			module_name: 'M7',
			allowed_scopes: ['booking-bypass'],
			is_active: true
		})
	];

	it('returns the same list order when the query is empty and no status cut is set', () => {
		const result = filterThirdPartyClients(rows, openFilter);
		expect(result.map((client) => client.id)).toEqual(['1', '2', '3', '4', '5']);
		expect(result[0]).toBe(rows[0]);
	});

	it('returns an empty list unchanged', () => {
		expect(filterThirdPartyClients([], openFilter)).toEqual([]);
		expect(
			filterThirdPartyClients([], { query: 'pii', status: 'active', sensitiveOnly: true })
		).toEqual([]);
	});

	it('matches display name, client id, description, and scope code', () => {
		expect(
			filterThirdPartyClients(rows, { ...openFilter, query: '  Songkhla ' }).map((c) => c.id)
		).toEqual(['1']);
		expect(
			filterThirdPartyClients(rows, { ...openFilter, query: 'TPC_WH' }).map((c) => c.id)
		).toEqual(['2']);
		expect(
			filterThirdPartyClients(rows, { ...openFilter, query: 'สั่งการ' }).map((c) => c.id)
		).toEqual(['1']);
		expect(filterThirdPartyClients(rows, { ...openFilter, query: 'pii' }).map((c) => c.id)).toEqual(
			['3']
		);
		expect(filterThirdPartyClients(rows, { ...openFilter, query: 'PII' }).map((c) => c.id)).toEqual(
			['3']
		);
		expect(
			filterThirdPartyClients(rows, { ...openFilter, query: 'booking' }).map((c) => c.id)
		).toEqual(['4', '5']);
	});

	it('matches a legacy client by client id when name is null and ignores a null description', () => {
		const legacy = sampleClient({
			id: '9',
			client_id: 'legacy-key',
			name: null,
			description: null
		});
		expect(
			filterThirdPartyClients([legacy], { ...openFilter, query: 'legacy-key' }).map((c) => c.id)
		).toEqual(['9']);
		expect(
			filterThirdPartyClients(rows, { ...openFilter, query: 'คลัง' }).map((c) => c.id)
		).toEqual(['2']);
	});

	it('does not match the module label unless that text is already in a searched field', () => {
		expect(filterThirdPartyClients(rows, { ...openFilter, query: 'จัดการทรัพยากร' })).toEqual([]);
	});

	it('filters active and revoked without changing relative order', () => {
		expect(
			filterThirdPartyClients(rows, { ...openFilter, status: 'active' }).map((c) => c.id)
		).toEqual(['1', '3', '5']);
		expect(
			filterThirdPartyClients(rows, { ...openFilter, status: 'revoked' }).map((c) => c.id)
		).toEqual(['2', '4']);
	});

	it('keeps sensitive clients of any status when sensitiveOnly is set', () => {
		expect(
			filterThirdPartyClients(rows, { ...openFilter, sensitiveOnly: true }).map((c) => c.id)
		).toEqual(['3', '4', '5']);
	});

	it('ANDs query, status, and sensitiveOnly', () => {
		expect(
			filterThirdPartyClients(rows, {
				query: 'booking',
				status: 'active',
				sensitiveOnly: true
			}).map((c) => c.id)
		).toEqual(['5']);
		expect(
			filterThirdPartyClients(rows, { query: 'pii', status: 'active', sensitiveOnly: true }).map(
				(c) => c.id
			)
		).toEqual(['3']);
		expect(
			filterThirdPartyClients(rows, { query: '', status: 'revoked', sensitiveOnly: true }).map(
				(c) => c.id
			)
		).toEqual(['4']);
		expect(
			filterThirdPartyClients(rows, {
				query: 'booking',
				status: 'revoked',
				sensitiveOnly: false
			}).map((c) => c.id)
		).toEqual(['4']);
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
