import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ building: false, dev: false }));

describe('hooks.server', () => {
	it('has no server init: print housekeeping is driven by the internal endpoint, not a timer', async () => {
		const setInterval = vi.spyOn(globalThis, 'setInterval');

		const hooks = await import('./hooks.server');
		await (hooks as { init?: () => unknown }).init?.();

		expect(hooks).not.toHaveProperty('init');
		expect(setInterval).not.toHaveBeenCalled();
		setInterval.mockRestore();
	});

	it('lets first-party pages request GPS', async () => {
		const { handle } = await import('./hooks.server');

		const response = await handle({
			event: {} as never,
			resolve: async () => new Response('ok')
		});

		expect(response.headers.get('Permissions-Policy')).toBe('geolocation=(self)');
	});
});
