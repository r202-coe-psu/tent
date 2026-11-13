import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/user-service', () => ({ getCurrentUserProfile: vi.fn() }));
vi.mock('$lib/server/integrations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/integrations')>()),
	integrationRequest: vi.fn()
}));

const { findMasterByCode } = await import('$lib/server/shelters.admin');
const { getCurrentUserProfile } = await import('$lib/server/user-service');
const { integrationRequest, IntegrationError } = await import('$lib/server/integrations');
const { cancelWithdrawal, createWithdrawal } = await import('./withdrawal.server');

const caller = {
	name: 'somchai',
	roles: ['shelter:SH001', 'SH001:warehouse_staff'],
	isSA: false,
	shelterCode: 'SH001'
};
type Payload = {
	shelter_code: string;
	external_ref: string;
	requester: Record<string, unknown>;
	destination: Record<string, unknown>;
	actor: Record<string, unknown>;
};

const ctx = { caller, shelterCode: 'SH001' };

const body = {
	source_warehouse_code: 'WH1',
	source_warehouse_name: 'คลังเมือง',
	reason: 'ของใกล้หมด',
	contact_role: 'หัวหน้า',
	contact_phone: '0812345678',
	lines: [{ item_code: 'W-1', name: 'น้ำ', unit: 'แพ็ค', type_code: 'water', qty: 4 }]
};

const master = {
	code: 'SH001',
	name: 'ศูนย์ทดสอบ',
	location: { address: '1 ถ.ทดสอบ', lat: 7.88, lng: 98.39 }
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(findMasterByCode).mockResolvedValue(master as never);
	vi.mocked(getCurrentUserProfile).mockResolvedValue({
		name: 'somchai',
		display_name: 'สมชาย ใจดี'
	} as never);
	vi.mocked(integrationRequest).mockResolvedValue({ request_code: 'WR-1', status: 'pending' });
});

describe('createWithdrawal', () => {
	it('posts the server-built payload to FastAPI', async () => {
		const out = await createWithdrawal(ctx, body, () => '01JXULID');
		expect(out).toMatchObject({ request_code: 'WR-1' });
		expect(integrationRequest).toHaveBeenCalledTimes(1);
		const [method, path, payload] = vi.mocked(integrationRequest).mock.calls[0] as [
			string,
			string,
			Payload
		];
		expect(method).toBe('POST');
		expect(path).toBe('/v1/integrations/m6/withdrawals');
		expect(payload.shelter_code).toBe('SH001');
		expect(payload.external_ref).toBe('TENT-SH001-01JXULID');
		expect(payload.requester).toMatchObject({
			location_code: 'SH001',
			location_name: 'ศูนย์ทดสอบ',
			contact_name: 'สมชาย ใจดี',
			contact_role: 'หัวหน้า',
			contact_phone: '0812345678',
			external_ref: 'TENT-SH001-01JXULID'
		});
		expect(payload.destination).toMatchObject({ lat: 7.88, lng: 98.39, address: '1 ถ.ทดสอบ' });
		expect(payload.actor).toEqual({ name: 'สมชาย ใจดี', username: 'somchai' });
	});

	it('ignores shelter, requester or actor fields the browser tries to send', async () => {
		await createWithdrawal(
			ctx,
			{
				...body,
				shelter_code: 'SH999',
				requester: { location_code: 'SH999' },
				actor: { name: 'x' }
			},
			() => 'ID'
		);
		const payload = vi.mocked(integrationRequest).mock.calls[0][2] as Payload;
		expect(payload.shelter_code).toBe('SH001');
		expect(payload.requester.location_code).toBe('SH001');
		expect(payload.actor.username).toBe('somchai');
	});

	it('falls back to the username when the profile cannot be read', async () => {
		vi.mocked(getCurrentUserProfile).mockRejectedValue(new Error('down'));
		await createWithdrawal(ctx, body, () => 'ID');
		const payload = vi.mocked(integrationRequest).mock.calls[0][2] as Payload;
		expect(payload.requester.contact_name).toBe('somchai');
	});

	it('answers 422 SHELTER_LOCATION_MISSING and never calls FastAPI', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({ ...master, location: { lat: null } } as never);
		await expect(createWithdrawal(ctx, body)).rejects.toMatchObject({
			status: 422,
			code: 'SHELTER_LOCATION_MISSING'
		});
		expect(integrationRequest).not.toHaveBeenCalled();
	});

	it('answers 422 VALIDATION for an invalid body without reading the shelter', async () => {
		await expect(createWithdrawal(ctx, { ...body, lines: [] })).rejects.toMatchObject({
			status: 422,
			code: 'VALIDATION'
		});
		expect(findMasterByCode).not.toHaveBeenCalled();
	});

	it('answers 404 when the shelter does not exist', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);
		await expect(createWithdrawal(ctx, body)).rejects.toMatchObject({
			status: 404,
			code: 'SHELTER_NOT_FOUND'
		});
	});

	it('passes a FastAPI error through unchanged', async () => {
		vi.mocked(integrationRequest).mockRejectedValue(
			new IntegrationError(422, 'M6_UNIT_MISMATCH', 'หน่วยไม่ตรง', { expected_unit: 'ลัง' })
		);
		await expect(createWithdrawal(ctx, body)).rejects.toMatchObject({
			code: 'M6_UNIT_MISMATCH',
			extra: { expected_unit: 'ลัง' }
		});
	});
});

describe('cancelWithdrawal', () => {
	it('posts the reason with the shelter and actor taken from the session', async () => {
		await cancelWithdrawal(ctx, 'WR/1', { reason: 'สั่งผิด', shelter_code: 'SH999' });
		expect(integrationRequest).toHaveBeenCalledWith(
			'POST',
			'/v1/integrations/m6/withdrawals/WR%2F1/cancel',
			{
				shelter_code: 'SH001',
				reason: 'สั่งผิด',
				actor: { name: 'สมชาย ใจดี', username: 'somchai' }
			}
		);
	});

	it('requires a reason', async () => {
		await expect(cancelWithdrawal(ctx, 'WR-1', { reason: ' ' })).rejects.toMatchObject({
			status: 422,
			code: 'VALIDATION'
		});
		expect(integrationRequest).not.toHaveBeenCalled();
	});
});
