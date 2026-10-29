import { describe, expect, it, vi } from 'vitest';

const { mockCreateUser } = vi.hoisted(() => ({ mockCreateUser: vi.fn() }));

vi.mock('$lib/server/user-service', () => ({ createUser: mockCreateUser }));

import { POST } from './+server';

function post(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/register', () => {
	it('answers 404 and creates no _users account for an anonymous signup', async () => {
		await expect(
			post({ username: 'mallory', password: 'Str0ng-Passphrase!' })
		).rejects.toMatchObject({ status: 404 });
		expect(mockCreateUser).not.toHaveBeenCalled();
	});
});
