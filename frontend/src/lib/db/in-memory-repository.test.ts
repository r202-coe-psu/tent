import { describe, expect, it } from 'vitest';
import { createInMemoryRepository } from './in-memory-repository';

type Row = { _id: string; type: string; name: string; contact?: { phone: string } };

async function seeded() {
	const repo = createInMemoryRepository();
	for (const row of [
		{ _id: 'p:3', type: 'p', name: 'c', contact: { phone: '0833' } },
		{ _id: 'p:1', type: 'p', name: 'a', contact: { phone: '0811' } },
		{ _id: 'p:2', type: 'p', name: 'b' },
		{ _id: 'q:1', type: 'q', name: 'z', contact: { phone: '0811' } }
	] satisfies Row[]) {
		await repo.put(row);
	}
	return repo;
}

describe('createInMemoryRepository selectors', () => {
	it('resolves dotted paths in equality and range conditions for find', async () => {
		const repo = await seeded();
		const equal = await repo.find<Row>({ selector: { type: 'p', 'contact.phone': '0811' } });
		expect(equal.map((r) => r._id)).toEqual(['p:1']);
		const range = await repo.find<Row>({
			selector: { 'contact.phone': { $gte: '08', $lt: '08￰' } }
		});
		expect(range.map((r) => r._id).sort()).toEqual(['p:1', 'p:3', 'q:1']);
	});
});

describe('createInMemoryRepository.findPage', () => {
	it('pages in _id order with the returned bookmark, covering every match once', async () => {
		const repo = await seeded();
		const seen: string[] = [];
		let bookmark: string | null | undefined;
		for (let i = 0; i < 5; i++) {
			const page = await repo.findPage<Row>({
				selector: { type: 'p' },
				limit: 2,
				...(bookmark ? { bookmark } : {})
			});
			seen.push(...page.docs.map((d) => d._id));
			if (page.docs.length < 2) break;
			bookmark = page.bookmark;
		}
		expect(seen).toEqual(['p:1', 'p:2', 'p:3']);
	});

	it('defaults the limit to 25', async () => {
		const repo = createInMemoryRepository();
		for (let i = 0; i < 30; i++)
			await repo.put({ _id: `n:${String(i).padStart(2, '0')}`, type: 'n' });
		expect((await repo.findPage({ selector: { type: 'n' } })).docs).toHaveLength(25);
	});

	it('compares string ranges like CouchDB ICU collation, not by code point', async () => {
		const repo = createInMemoryRepository();
		for (const [id, name] of [
			['e:1', 'Somchai'],
			['e:2', 'SOMBAT'],
			['e:3', 'Mary']
		])
			await repo.put({ _id: id, type: 'e', name });
		const page = await repo.findPage<{ _id: string }>({
			selector: { type: 'e', name: { $gte: 'som', $lt: 'som\ufff0' } }
		});
		expect(page.docs.map((d) => d._id).sort()).toEqual(['e:1', 'e:2']);
	});
});
