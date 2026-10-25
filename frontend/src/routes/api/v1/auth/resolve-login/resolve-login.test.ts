import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

type PostEvent = Parameters<typeof POST>[0];

const resolveLoginName = vi.fn<(identifier: string) => Promise<string>>();

vi.mock('$lib/server/user-service', () => ({
	resolveLoginName: (identifier: string) => resolveLoginName(identifier)
}));

function makeEvent(body: unknown, ip = '127.0.0.1'): PostEvent {
	return {
		request: new Request('http://localhost/api/v1/auth/resolve-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	} as PostEvent;
}

describe('POST /api/v1/auth/resolve-login', () => {
	beforeEach(() => {
		resolveLoginName.mockReset();
	});

	it('returns resolved CouchDB name for a phone hit', async () => {
		resolveLoginName.mockResolvedValue('staff01');
		const res = await POST(makeEvent({ identifier: '0812345678' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, name: 'staff01' });
		expect(resolveLoginName).toHaveBeenCalledWith('0812345678');
	});

	it('returns the identifier when no mapping exists', async () => {
		resolveLoginName.mockResolvedValue('0810000000');
		const res = await POST(makeEvent({ identifier: '0810000000' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, name: '0810000000' });
	});

	it('returns 400 when identifier is missing', async () => {
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ ok: false, error: 'identifier is required' });
		expect(resolveLoginName).not.toHaveBeenCalled();
	});
});
