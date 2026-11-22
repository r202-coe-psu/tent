import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('shelter-close worker ingress isolation (CR-243 FR-37, AC-9)', () => {
	it('denies /api/internal/shelter-close/worker/ on the public listener, before the catch-all', () => {
		const nginx = read('nginx/nginx.conf');
		expect(nginx).toMatch(
			/location\s+\^~\s+\/api\/internal\/shelter-close\/worker\/\s*\{[\s\S]*?return\s+404;/
		);
		const block = nginx.indexOf('/api/internal/shelter-close/worker/');
		const catchAll = nginx.indexOf('location / {');
		expect(block).toBeGreaterThan(-1);
		expect(catchAll).toBeGreaterThan(-1);
		expect(block).toBeLessThan(catchAll);
	});

	it('keeps the import worker block (no regression from sharing the file)', () => {
		expect(read('nginx/nginx.conf')).toContain('/api/internal/shelter-import/worker/');
	});
});
