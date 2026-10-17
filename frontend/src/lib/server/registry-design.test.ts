import { describe, expect, it } from 'vitest';
import {
	buildRegistryDesignDoc,
	buildRegistryValidateDocUpdate,
	REGISTRY_DESIGN_VERSION,
	registryByNamePath
} from './registry-design';

describe('registry shelter lookup design', () => {
	it('contains the indexed normalized-name view used by import duplicate checks', () => {
		const design = buildRegistryDesignDoc();

		expect(design.version).toBe(REGISTRY_DESIGN_VERSION);
		expect(REGISTRY_DESIGN_VERSION).toBe(7);
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

	it('rejects schema_v other than 1', () => {
		expect(() => runVdu(validBanner({ schema_v: 2 }))).toThrow(
			expect.objectContaining({ forbidden: expect.any(String) })
		);
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
