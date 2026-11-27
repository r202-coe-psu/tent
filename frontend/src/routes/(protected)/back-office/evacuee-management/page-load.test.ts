import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/guards/auth', () => ({ requireEvacueeRegistration: async () => {} }));

import { load } from './+page';

async function redirectOf(search: string): Promise<{ status: number; location: string } | null> {
	try {
		await load({
			fetch,
			url: new URL(`http://localhost/back-office/evacuee-management${search}`)
		} as unknown as Parameters<typeof load>[0]);
		return null;
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location };
		throw e;
	}
}

describe('evacuee-management legacy dashboard / meals tabs now live under overview', () => {
	it('sends ?tab=dashboard to the evacuee overview and keeps the shelter param', async () => {
		expect(await redirectOf('?tab=dashboard&shelter=SH001')).toEqual({
			status: 307,
			location: '/back-office/overview/evacuees?shelter=SH001'
		});
	});

	it('sends ?tab=meals to the food overview', async () => {
		expect(await redirectOf('?tab=meals')).toEqual({
			status: 307,
			location: '/back-office/overview/food'
		});
	});

	it('does not redirect the people and household tabs', async () => {
		expect(await redirectOf('?tab=evacuee')).toBeNull();
		expect(await redirectOf('?tab=household&shelter=SH001')).toBeNull();
		expect(await redirectOf('')).toBeNull();
	});
});
