import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from './+server';
import { adminRaw, authorizeUserWrite } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];
type PutEvent = Parameters<typeof PUT>[0];

const { MockServiceError } = vi.hoisted(() => {
	class MockServiceError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	}
	return { MockServiceError };
});

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	authorizeUserWrite: vi.fn(),
	ServiceError: MockServiceError,
	serviceError: (e: unknown) => {
		if (e instanceof MockServiceError) {
			const status =
				e.code === 'UNAUTHENTICATED'
					? 401
					: e.code === 'FORBIDDEN'
						? 403
						: e.code === 'VALIDATION'
							? 400
							: 500;
			return Response.json({ error: { code: e.code, message: e.message } }, { status });
		}
		return Response.json(
			{ error: { code: 'INTERNAL', message: 'Internal error' } },
			{ status: 500 }
		);
	}
}));

function getEvent(): GetEvent {
	return {
		request: new Request('http://localhost/api/v1/app-config', {
			headers: { Cookie: 'AuthSession=x' }
		})
	} as GetEvent;
}

function putEvent(body: unknown): PutEvent {
	return {
		request: new Request('http://localhost/api/v1/app-config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Cookie: 'AuthSession=x' },
			body: JSON.stringify(body)
		})
	} as PutEvent;
}

describe('/api/v1/app-config', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('GET forbids non-SA callers', async () => {
		vi.mocked(authorizeUserWrite).mockResolvedValue({
			name: 'mgr',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		const res = await GET(getEvent());
		expect(res.status).toBe(403);
	});

	it('GET returns settled defaults when doc is missing', async () => {
		vi.mocked(authorizeUserWrite).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });
		const res = await GET(getEvent());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.exists).toBe(false);
		expect(body.config.recaptcha_enabled).toBe(true);
	});

	it('PUT flips recaptcha_enabled for SA', async () => {
		vi.mocked(authorizeUserWrite).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockImplementation(async (_path: string, method: string) => {
			if (method === 'GET') {
				return {
					status: 200,
					data: {
						_id: 'config:app',
						_rev: '1-abc',
						type: 'config',
						recaptcha_enabled: true,
						public_otp_required: false
					}
				};
			}
			return { status: 201, data: { ok: true, id: 'config:app', rev: '2-def' } };
		});

		const res = await PUT(putEvent({ recaptcha_enabled: false }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.config.recaptcha_enabled).toBe(false);

		const putCall = vi.mocked(adminRaw).mock.calls.find((c) => c[1] === 'PUT');
		expect(putCall?.[2]).toMatchObject({
			_id: 'config:app',
			_rev: '1-abc',
			recaptcha_enabled: false,
			updated_by: 'admin'
		});
	});

	it('PUT forbids non-SA', async () => {
		vi.mocked(authorizeUserWrite).mockResolvedValue({
			name: 'mgr',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		const res = await PUT(putEvent({ recaptcha_enabled: false }));
		expect(res.status).toBe(403);
		expect(adminRaw).not.toHaveBeenCalled();
	});
});
