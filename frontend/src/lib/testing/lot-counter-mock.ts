/**
 * Test helper: an in-memory `lot_counter` doc store for `adminRaw` mocks (CR-244).
 * Call `handle(path, method, body)` first in the mock; it answers GET/PUT on a
 * `lot_counter` path with `_rev` compare-and-swap semantics, else returns `undefined`.
 */
export function createLotCounterMock() {
	const docs = new Map<string, Record<string, unknown>>();
	let rev = 0;
	return {
		docs,
		handle(
			path: string,
			method: string,
			body?: unknown
		): { status: number; data: unknown } | undefined {
			if (!path.includes('lot_counter')) return undefined;
			const id = decodeURIComponent(path.split('/').pop()!.split('?')[0]);
			const current = docs.get(id);
			if (method === 'GET') {
				return current
					? { status: 200, data: current }
					: { status: 404, data: { error: 'not_found' } };
			}
			if (method === 'PUT') {
				const doc = body as Record<string, unknown>;
				if (current?._rev !== doc._rev) return { status: 409, data: { error: 'conflict' } };
				const saved = { ...doc, _rev: `${++rev}-lc` };
				docs.set(id, saved);
				return { status: 201, data: { ok: true, id, rev: saved._rev } };
			}
			return undefined;
		}
	};
}
