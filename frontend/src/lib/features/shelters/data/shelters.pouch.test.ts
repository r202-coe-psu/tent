// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';

PouchDB.plugin(memory);

let testDb: PouchDB.Database;

vi.mock('$lib/db/pouch', () => ({
	namedLocalDb: () => testDb
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		user: { name: 'admin', roles: ['system_admin'] }
	}
}));

import { SheltersPouchRepository } from './shelters.pouch';

const ts = '2026-01-01T00:00:00.000Z';

async function seedShelter(code: string, name: string) {
	await testDb.put({
		_id: `shelter:01${code}`,
		type: 'shelter',
		schema_v: 3,
		code,
		name,
		capacity: 100,
		created_at: ts,
		updated_at: ts
	});
}

describe('SheltersPouchRepository', () => {
	let repo: SheltersPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`registry-test-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		repo = new SheltersPouchRepository('registry');
	});

	afterEach(async () => {
		await testDb.destroy();
	});

	it('lists shelter masters from local registry', async () => {
		await seedShelter('SH001', 'ศูนย์ A');
		await seedShelter('SH002', 'ศูนย์ B');

		const list = await repo.listShelters();

		expect(list).toHaveLength(2);
		expect(list.map((s) => s.code).sort()).toEqual(['SH001', 'SH002']);
		expect(list[0].db).toBe('shelter_sh001');
	});

	it('gets a shelter by code', async () => {
		await seedShelter('SH001', 'ศูนย์ A');

		const shelter = await repo.getShelter('SH001');

		expect(shelter.name).toBe('ศูนย์ A');
		expect(shelter.db).toBe('shelter_sh001');
	});

	it('throws when shelter code is not found', async () => {
		await expect(repo.getShelter('SH999')).rejects.toThrow('ไม่พบศูนย์พักพิง SH999');
	});
});
