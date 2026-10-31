import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseDocsOrSkip } from './parse-or-skip';

const schema = z.object({ _id: z.string(), type: z.string(), n: z.number() });

describe('parseDocsOrSkip', () => {
	it('returns valid docs and reports malformed ones instead of throwing', () => {
		const good = { _id: 'a:1', type: 'a', n: 1 };
		const bad = { _id: 'a:2', type: 'a', n: 'x' };
		const { items, skipped } = parseDocsOrSkip<{ _id: string }>(
			[good, bad, { ...good, _id: 'a:3' }],
			schema
		);
		expect(items.map((i) => i._id)).toEqual(['a:1', 'a:3']);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]._id).toBe('a:2');
		expect(skipped[0].type).toBe('a');
		expect(skipped[0].reason.length).toBeGreaterThan(0);
	});

	it('uses empty _id/type for non-object docs', () => {
		const { items, skipped } = parseDocsOrSkip([null, 'str', 42], schema);
		expect(items).toEqual([]);
		expect(skipped).toHaveLength(3);
		for (const s of skipped) {
			expect(s._id).toBe('');
			expect(s.type).toBe('');
			expect(s.reason.length).toBeGreaterThan(0);
		}
	});

	it('falls back to a generic reason when there are no issues', () => {
		const parser = { safeParse: () => ({ success: false as const, error: { issues: [] } }) };
		expect(parseDocsOrSkip([{ _id: 'x', type: 't' }], parser).skipped).toEqual([
			{ _id: 'x', type: 't', reason: 'invalid document' }
		]);
	});
});
