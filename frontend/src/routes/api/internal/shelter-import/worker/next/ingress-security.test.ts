import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('internal worker route ingress isolation', () => {
	it('blocks internal worker endpoints on public ingress in nginx.conf', () => {
		const nginxConfigPath = resolve(process.cwd(), '../nginx/nginx.conf');
		const nginxConfig = readFileSync(nginxConfigPath, 'utf8');

		// Location block must use ^~ prefix match to take precedence over regular expressions
		expect(nginxConfig).toMatch(
			/location\s+\^~\s+\/api\/internal\/shelter-import\/worker\/\s*\{[\s\S]*?return\s+404;/
		);

		// Must appear BEFORE the catch-all location / block
		const blockIndex = nginxConfig.indexOf('/api/internal/shelter-import/worker/');
		const catchAllIndex = nginxConfig.indexOf('location / {');
		expect(blockIndex).toBeGreaterThan(-1);
		expect(catchAllIndex).toBeGreaterThan(-1);
		expect(blockIndex).toBeLessThan(catchAllIndex);
	});
});
