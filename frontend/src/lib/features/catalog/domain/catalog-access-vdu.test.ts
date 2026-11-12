import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type UserCtx = { name: string; roles: string[] };
type Vdu = (
	newDoc: Record<string, unknown>,
	oldDoc: Record<string, unknown> | null,
	userCtx: UserCtx
) => void;

/** Both scripts deploy `catalog/_design/access`; evaluate the source each one ships. */
function loadCatalogVdu(relativePath: string): Vdu {
	const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
	const start = source.indexOf('const validateFn = `');
	const end = source.indexOf('}`;', start);
	const body = source.slice(start + 'const validateFn = `'.length, end + 1);
	return new Function(`return (${body});`)() as Vdu;
}

const VDUS = {
	'sync-central-db': loadCatalogVdu('../../../../../scripts/sync-central-db.ts'),
	'master-seed': loadCatalogVdu('../../../../../scripts/seed/master-seed.ts')
};

const DON: UserCtx = { name: 'don', roles: ['shelter:SH001', 'SH001:donation_staff'] };
const WS: UserCtx = { name: 'ws', roles: ['shelter:SH001', 'warehouse_staff'] };

const item = {
	_id: 'item_master:local-rice',
	type: 'item_master',
	shelter_code: 'SH001',
	name: 'ข้าวสาร',
	base_unit: 'kg'
};

describe.each(Object.entries(VDUS))('catalog VDU (%s) — CR-227 donation_staff', (_name, vdu) => {
	it('lets donation_staff create and edit its own shelter item_master', () => {
		expect(() => vdu(item, null, DON)).not.toThrow();
		expect(() => vdu({ ...item, name: 'ข้าวหอม' }, item, DON)).not.toThrow();
	});

	it('rejects donation_staff setting merged_into', () => {
		const merged = { ...item, merged_into: 'item_master:other', deactivated: true };
		expect(() => vdu(merged, item, DON)).toThrow();
		expect(() => vdu(merged, item, WS)).not.toThrow();
	});

	it('allows donation_staff to edit an already-merged item without changing the pointer', () => {
		const merged = { ...item, merged_into: 'item_master:other', deactivated: true };
		expect(() => vdu({ ...merged, name: 'ข้าวเก่า' }, merged, DON)).not.toThrow();
	});

	it('rejects donation_staff writing non-item_master catalog docs', () => {
		const recipe = { _id: 'recipe:local', type: 'recipe', shelter_code: 'SH001', ingredients: [] };
		expect(() => vdu(recipe, null, DON)).toThrow();
		expect(() => vdu(recipe, null, WS)).not.toThrow();
	});

	it('rejects donation_staff of another shelter', () => {
		const other: UserCtx = { name: 'don2', roles: ['shelter:SH001', 'SH002:donation_staff'] };
		expect(() => vdu(item, null, other)).toThrow();
	});
});

describe.each(Object.entries(VDUS))('catalog VDU (%s) — #832 compound roles', (_name, vdu) => {
	it.each(['shelter_manager', 'warehouse_staff'])('accepts compound SH001:%s', (role) => {
		const user: UserCtx = { name: 'u', roles: ['shelter:SH001', `SH001:${role}`] };
		expect(() => vdu(item, null, user)).not.toThrow();
	});

	it.each(['shelter_manager', 'warehouse_staff'])('accepts bare %s', (role) => {
		const user: UserCtx = { name: 'u', roles: ['shelter:SH001', role] };
		expect(() => vdu(item, null, user)).not.toThrow();
	});

	it.each(['shelter_manager', 'warehouse_staff'])(
		'rejects compound %s of another shelter',
		(role) => {
			const user: UserCtx = { name: 'u', roles: ['shelter:SH001', `SH002:${role}`] };
			expect(() => vdu(item, null, user)).toThrow();
		}
	);

	it('rejects a compound role without shelter scope', () => {
		const user: UserCtx = { name: 'u', roles: ['SH001:shelter_manager'] };
		expect(() => vdu(item, null, user)).toThrow();
	});
});
