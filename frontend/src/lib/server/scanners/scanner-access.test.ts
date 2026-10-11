import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';
import { ScannerDeviceNotFoundError } from './device-credentials';
import { assertCanCreateFor, assertDeviceInScope, requireScannerManager } from './scanner-access';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);

function asCaller(name: string | null, roles: string[]) {
	mockSession.mockResolvedValue({ name, roles });
	return requireScannerManager(
		new Request('http://localhost/x', { headers: { cookie: 'AuthSession=abc' } })
	);
}

describe('scanner access', () => {
	beforeEach(() => vi.clearAllMocks());

	it('rejects an anonymous request as UNAUTHENTICATED', async () => {
		await expect(asCaller(null, [])).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
	});

	it('rejects a registration_staff as FORBIDDEN', async () => {
		await expect(asCaller('reg', ['shelter:A', 'A:registration_staff'])).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('forwards the request cookie to the session lookup', async () => {
		await asCaller('sm-a', ['shelter:A', 'A:shelter_manager']);
		expect(mockSession).toHaveBeenCalledWith('AuthSession=abc');
	});

	it('lets a system admin reach a device of any shelter', async () => {
		const caller = await asCaller('sa', ['system_admin']);
		expect(() => assertDeviceInScope(caller, { shelter_code: 'B' })).not.toThrow();
		expect(() => assertCanCreateFor(caller, 'B')).not.toThrow();
	});

	it('lets a shelter manager reach own shelter but reads another shelter device as missing', async () => {
		const caller = await asCaller('sm-a', ['shelter:A', 'A:shelter_manager']);
		expect(() => assertDeviceInScope(caller, { shelter_code: 'A' })).not.toThrow();
		expect(() => assertDeviceInScope(caller, { shelter_code: 'B' })).toThrow(
			ScannerDeviceNotFoundError
		);
	});

	it('forbids creating a device in another shelter', async () => {
		const caller = await asCaller('sm-a', ['shelter:A', 'A:shelter_manager']);
		expect(() => assertCanCreateFor(caller, 'A')).not.toThrow();
		expect(() => assertCanCreateFor(caller, 'B')).toThrow(ServiceError);
		expect(() => assertCanCreateFor(caller, 'B')).toThrow('Not a shelter_manager of this shelter');
	});

	it('scopes a manager of A who is only registration staff in B to A', async () => {
		const caller = await asCaller('mixed', [
			'shelter:A',
			'shelter:B',
			'A:shelter_manager',
			'B:registration_staff'
		]);
		expect(caller.scope).toEqual(['A']);
		expect(() => assertDeviceInScope(caller, { shelter_code: 'B' })).toThrow(
			ScannerDeviceNotFoundError
		);
	});
});
