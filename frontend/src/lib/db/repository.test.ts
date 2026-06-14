// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import { createRepository, type Repository } from './repository';
import { makeDoc, type AuthorContext, type BaseDoc } from './model';

PouchDB.plugin(memory);

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

interface Note extends BaseDoc {
	type: 'note';
	body: string;
}
const isNote = (d: unknown): d is Note =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'note';

function newNote(body: string): Note {
	return makeDoc('note', 1, { body }, ctx);
}

describe('createRepository', () => {
	let db: PouchDB.Database;
	let repo: Repository;

	beforeEach(() => {
		db = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = createRepository(db);
	});

	it('put returns the doc stamped with a fresh _rev', async () => {
		const saved = await repo.put(newNote('hello'));
		expect(saved._rev).toMatch(/^1-/);
		expect(saved.body).toBe('hello');
	});

	it('get round-trips a stored doc and returns null for a missing id', async () => {
		const saved = await repo.put(newNote('hi'));
		const fetched = await repo.get<Note>(saved._id);
		expect(fetched?.body).toBe('hi');
		expect(await repo.get('note:does-not-exist')).toBeNull();
	});

	it('allByType returns only docs of the prefix, narrowed by the guard', async () => {
		await repo.put(newNote('a'));
		await repo.put(newNote('b'));
		await repo.put(makeDoc('evacuee', 1, { first_name: 'X' }, ctx));

		const notes = await repo.allByType('note', isNote);
		expect(notes).toHaveLength(2);
		expect(notes.every(isNote)).toBe(true);
	});

	it('put with a live _rev updates instead of conflicting', async () => {
		const saved = await repo.put(newNote('v1'));
		const updated = await repo.put({ ...saved, body: 'v2' });
		expect(updated._rev).toMatch(/^2-/);
		expect((await repo.get<Note>(saved._id))?.body).toBe('v2');
	});

	it('remove deletes a doc', async () => {
		const saved = await repo.put(newNote('bye'));
		await repo.remove(saved);
		expect(await repo.get(saved._id)).toBeNull();
	});
});
