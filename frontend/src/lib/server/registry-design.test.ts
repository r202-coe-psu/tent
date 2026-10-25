import { describe, expect, it } from 'vitest';
import {
	buildRegistryDesignDoc,
	buildRegistryValidateDocUpdate,
	KIOSK_BANNER_MANGO_INDEX,
	REGISTRY_DESIGN_VERSION,
	registryByNamePath
} from './registry-design';

describe('registry shelter lookup design', () => {
	it('contains the indexed normalized-name view used by import duplicate checks', () => {
		const design = buildRegistryDesignDoc();

		expect(design.version).toBe(REGISTRY_DESIGN_VERSION);
		expect(REGISTRY_DESIGN_VERSION).toBe(8);
		expect(design.views.by_normalized_name.map).toContain("doc.type === 'shelter'");
		expect(design.views.by_normalized_name.map).toContain("replace(/\\s+/g, ' ')");
	});

	it('normalizes the lookup key before generating the CouchDB view query', () => {
		const path = registryByNamePath('  ศูนย์   A  ');

		expect(path).toContain('by_normalized_name');
		expect(path).toContain(encodeURIComponent(JSON.stringify('ศูนย์ a')));
	});
});

type Vdu = (
	newDoc: Record<string, unknown>,
	oldDoc: Record<string, unknown> | null,
	userCtx: { roles: string[] },
	secObj: Record<string, unknown>
) => void;

function compileVdu(): Vdu {
	return new Function(`return ${buildRegistryValidateDocUpdate()}`)() as Vdu;
}

const ADMIN = { roles: ['_admin'] };

function validBanner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		_id: 'kiosk_banner:01H',
		type: 'kiosk_banner',
		schema_v: 1,
		shelter_code: 'SH001',
		title: 'Welcome',
		order: 1,
		duration_sec: 10,
		status: 'active',
		start_at: '2026-10-01T00:00:00.000Z',
		end_at: '2026-10-31T00:00:00.000Z',
		...overrides
	};
}

function runVdu(doc: Record<string, unknown>, userCtx = ADMIN): void {
	compileVdu()(doc, null, userCtx, {});
}

describe('registry kiosk_banner validate_doc_update', () => {
	it('accepts a valid kiosk_banner', () => {
		expect(() => runVdu(validBanner())).not.toThrow();
		expect(() => runVdu(validBanner({ caption: 'hello' }))).not.toThrow();
	});

	it('still rejects non-admin writers', () => {
		expect(() => runVdu(validBanner(), { roles: ['staff'] })).toThrow();
	});

	it('accepts legacy schema_v 1 banners without a group_id', () => {
		expect(() => runVdu(validBanner({ schema_v: 1 }))).not.toThrow();
	});

	it('accepts schema_v 2 banners with a kiosk_banner_group group_id', () => {
		expect(() =>
			runVdu(validBanner({ schema_v: 2, group_id: 'kiosk_banner_group:01H' }))
		).not.toThrow();
	});

	it.each([
		['schema_v 3', { schema_v: 3 }],
		['schema_v 0', { schema_v: 0 }],
		['missing schema_v', { schema_v: undefined }],
		['schema_v 2 without group_id', { schema_v: 2 }],
		['schema_v 2 with null group_id', { schema_v: 2, group_id: null }],
		['schema_v 2 with non-string group_id', { schema_v: 2, group_id: 5 }],
		['schema_v 2 with wrong-prefix group_id', { schema_v: 2, group_id: 'shelter:01H' }]
	])('rejects %s', (_label, overrides) => {
		expect(() => runVdu(validBanner(overrides))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
	});

	it('still applies the other banner checks to schema_v 2', () => {
		expect(() =>
			runVdu(validBanner({ schema_v: 2, group_id: 'kiosk_banner_group:01H', title: '  ' }))
		).toThrow(expect.objectContaining({ forbidden: expect.any(String) }));
	});

	it.each([
		['missing shelter_code', { shelter_code: undefined }],
		['empty shelter_code', { shelter_code: '' }],
		['non-string shelter_code', { shelter_code: 5 }],
		['non-string title', { title: 5 }],
		['blank title', { title: '   ' }],
		['title over 120 chars', { title: 'x'.repeat(121) }],
		['non-string caption', { caption: 5 }],
		['caption over 200 chars', { caption: 'x'.repeat(201) }]
	])('rejects %s', (_label, overrides) => {
		expect(() => runVdu(validBanner(overrides))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
	});

	it('accepts boundary title/caption lengths and null caption', () => {
		expect(() =>
			runVdu(validBanner({ title: 'x'.repeat(120), caption: 'y'.repeat(200) }))
		).not.toThrow();
		expect(() => runVdu(validBanner({ caption: null }))).not.toThrow();
	});

	it.each([
		['order 0', { order: 0 }],
		['fractional order', { order: 1.5 }],
		['string order', { order: '1' }],
		['duration_sec 2', { duration_sec: 2 }],
		['duration_sec 61', { duration_sec: 61 }],
		['fractional duration_sec', { duration_sec: 5.5 }],
		['string duration_sec', { duration_sec: '10' }],
		['unknown status', { status: 'draft' }],
		['missing status', { status: undefined }],
		['unknown screen_type', { screen_type: 'landscape' }],
		['null screen_type', { screen_type: null }],
		['numeric screen_type', { screen_type: 1 }]
	])('rejects %s', (_label, overrides) => {
		expect(() => runVdu(validBanner(overrides))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
	});

	it('accepts compact, portrait and an absent screen_type', () => {
		for (const screen_type of ['compact', 'portrait', undefined]) {
			expect(() => runVdu(validBanner({ screen_type }))).not.toThrow();
		}
	});

	it('accepts boundary order/duration and inactive status', () => {
		expect(() => runVdu(validBanner({ order: 1, duration_sec: 3 }))).not.toThrow();
		expect(() =>
			runVdu(validBanner({ order: 99, duration_sec: 60, status: 'inactive' }))
		).not.toThrow();
	});

	it.each([
		['missing start_at', { start_at: undefined }],
		['unparseable start_at', { start_at: 'not-a-date' }],
		['non-string end_at', { end_at: 12 }],
		['unparseable end_at', { end_at: 'nope' }],
		['end_at equal to start_at', { end_at: '2026-10-01T00:00:00.000Z' }],
		['end_at before start_at', { end_at: '2026-09-01T00:00:00.000Z' }]
	])('rejects %s', (_label, overrides) => {
		expect(() => runVdu(validBanner(overrides))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
	});

	it('lets a _deleted kiosk_banner through even when fields are missing', () => {
		expect(() =>
			runVdu({ _id: 'kiosk_banner:01H', type: 'kiosk_banner', _deleted: true })
		).not.toThrow();
	});

	it('does not apply banner rules to other doc types', () => {
		expect(() =>
			runVdu({ _id: 'shelter:01H', type: 'shelter', code: 'SH001', name: 'A' })
		).not.toThrow();
	});
});

function validGroup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		_id: 'kiosk_banner_group:01H',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH001',
		name: 'Lobby',
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff1',
		...overrides
	};
}

describe('registry kiosk_banner_group validate_doc_update', () => {
	it('accepts a valid group, with or without description', () => {
		expect(() => runVdu(validGroup())).not.toThrow();
		expect(() => runVdu(validGroup({ description: 'front desk' }))).not.toThrow();
		expect(() => runVdu(validGroup({ description: null }))).not.toThrow();
	});

	it('accepts boundary name and description lengths', () => {
		expect(() =>
			runVdu(validGroup({ name: 'x'.repeat(60), description: 'y'.repeat(200) }))
		).not.toThrow();
		expect(() => runVdu(validGroup({ name: ' a ' }))).not.toThrow();
	});

	it('still rejects non-admin writers', () => {
		expect(() => runVdu(validGroup(), { roles: ['staff'] })).toThrow();
	});

	it.each([
		['schema_v 2', { schema_v: 2 }],
		['missing schema_v', { schema_v: undefined }],
		['wrong _id prefix', { _id: 'kiosk_banner:01H' }],
		['missing shelter_code', { shelter_code: undefined }],
		['empty shelter_code', { shelter_code: '' }],
		['non-string shelter_code', { shelter_code: 5 }],
		['non-string name', { name: 5 }],
		['blank name', { name: '   ' }],
		['name over 60 chars', { name: 'x'.repeat(61) }],
		['non-string description', { description: 5 }],
		['description over 200 chars', { description: 'x'.repeat(201) }],
		['missing created_at', { created_at: undefined }],
		['empty updated_at', { updated_at: '' }],
		['non-string created_by', { created_by: 5 }]
	])('rejects %s', (_label, overrides) => {
		expect(() => runVdu(validGroup(overrides))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
	});

	it('lets a _deleted group through even when fields are missing', () => {
		expect(() =>
			runVdu({ _id: 'kiosk_banner_group:01H', type: 'kiosk_banner_group', _deleted: true })
		).not.toThrow();
	});
});

describe('registry Mango indexes', () => {
	// CouchDB only picks a json index when the selector names every indexed field, so the index
	// must match the banner list selector `{ type, shelter_code }` exactly.
	it('indexes exactly the fields the shelter banner list selects on', () => {
		expect(KIOSK_BANNER_MANGO_INDEX.index.fields).toEqual(['type', 'shelter_code']);
	});
});
