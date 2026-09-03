import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/guards/auth', () => ({
	requireEvacueeRegistration: vi.fn().mockResolvedValue(undefined)
}));

import { load } from './+page';
import { requireEvacueeRegistration } from '$lib/guards/auth';

async function runLoad(url: URL) {
	return load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
}

describe('onsite/search-edit/results load guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /onsite/search-edit when q is missing', async () => {
		const url = new URL('http://localhost/onsite/search-edit/results');
		await expect(runLoad(url)).rejects.toMatchObject({
			status: 302,
			location: '/onsite/search-edit'
		});
	});

	it('redirects to /onsite/search-edit when q is whitespace-only', async () => {
		const url = new URL('http://localhost/onsite/search-edit/results?q=%20%20%20');
		await expect(runLoad(url)).rejects.toMatchObject({
			status: 302,
			location: '/onsite/search-edit'
		});
	});

	it('does not redirect when q has real content', async () => {
		const url = new URL('http://localhost/onsite/search-edit/results?q=สมชาย');
		await expect(runLoad(url)).resolves.toBeUndefined();
	});

	it('does not redirect when q has content padded with whitespace', async () => {
		const url = new URL('http://localhost/onsite/search-edit/results?q=%20สมชาย%20');
		await expect(runLoad(url)).resolves.toBeUndefined();
	});

	it('runs the evacuee registration guard before checking q', async () => {
		const url = new URL('http://localhost/onsite/search-edit/results?q=สมชาย');
		await runLoad(url);
		expect(requireEvacueeRegistration).toHaveBeenCalledTimes(1);
	});
});
