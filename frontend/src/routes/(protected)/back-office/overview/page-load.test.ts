import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

import { load } from './+page';

describe('/back-office/overview', () => {
	it('redirects to the evacuee overview and keeps the query string', () => {
		let caught: unknown;
		try {
			load({
				url: new URL('http://localhost/back-office/overview?shelter=SH001')
			} as unknown as Parameters<typeof load>[0]);
		} catch (e) {
			caught = e;
		}
		expect(isRedirect(caught)).toBe(true);
		expect(caught).toMatchObject({
			status: 307,
			location: '/back-office/overview/evacuees?shelter=SH001'
		});
	});
});
