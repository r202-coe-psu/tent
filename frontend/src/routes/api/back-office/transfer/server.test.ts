/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import type { StockTransfer } from '$lib/features/operations/domain/operations';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn(),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock('$lib/features/operations/data/transfer.server-repository', () => {
	class MockTransferServerRepository {
		list = mockList;
		create = mockCreate;
	}
	return {
		TransferServerRepository: MockTransferServerRepository
	};
});

function createMockEvent(
	searchParams: Record<string, string> = {},
	body: unknown = null,
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL('http://localhost/api/back-office/transfer');
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			},
			json: async () => body
		},
		url
	} as unknown as RequestEvent;
}

describe('BFF Transfer List and Create Endpoints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/back-office/transfer', () => {
		it('returns 403 when caller lacks warehouse/manager/SA role', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'staff_user',
				roles: ['registration_staff'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent();
			const res = await GET(event);
			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.error).toContain('warehouse_staff');
		});

		it.each([
			['flat', ['supply_coordinator', 'shelter:SH002']],
			['shelter-scoped', ['SH002:supply_coordinator', 'shelter:SH002']]
		])(
			'allows supply_coordinator (%s role), as the supply page guard does (#571)',
			async (_, roles) => {
				vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
					name: 'sc_user',
					roles,
					isSA: false,
					shelterCode: 'SH002'
				});
				mockList.mockResolvedValue([]);

				const res = await GET(createMockEvent());

				expect(res.status).toBe(200);
				expect(mockList).toHaveBeenCalled();
			}
		);

		it.each([
			['supply_coordinator', 'SH002:supply_coordinator'],
			['shelter_manager', 'SH002:shelter_manager']
		])(
			'refuses a %s of another shelter — the capability must be in the shelter acted on',
			async (_, capability) => {
				vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
					name: 'two_shelter_user',
					roles: ['shelter:SH001', 'shelter:SH002', 'SH001:registration_staff', capability],
					isSA: false,
					shelterCode: 'SH001'
				});

				const res = await GET(createMockEvent({ shelter_code: 'SH001' }));

				expect(res.status).toBe(403);
				expect(mockList).not.toHaveBeenCalled();
			}
		);

		it('lets a multi-shelter user pick the shelter they hold the capability in (#477)', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'two_shelter_user',
				roles: [
					'shelter:SH001',
					'shelter:SH002',
					'SH001:registration_staff',
					'SH002:warehouse_staff'
				],
				isSA: false,
				shelterCode: 'SH001'
			});
			mockList.mockResolvedValue([]);

			const res = await GET(createMockEvent({ shelter_code: 'SH002' }));

			expect(res.status).toBe(200);
			expect(mockList).toHaveBeenCalled();
		});

		it('400 when a multi-shelter user names no shelter — the first is not assumed (#477)', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'two_shelter_user',
				roles: ['shelter:SH001', 'shelter:SH002', 'SH001:warehouse_staff', 'SH002:warehouse_staff'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const res = await GET(createMockEvent());

			expect(res.status).toBe(400);
			expect(mockList).not.toHaveBeenCalled();
		});

		it('lets supply_coordinator create a transfer request too (#571)', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'sc_user',
				roles: ['SH001:supply_coordinator', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});
			mockCreate.mockResolvedValue({ _id: 'stock_transfer:new', status: 'requested' });

			const res = await POST(
				createMockEvent(
					{},
					{
						from_shelter: 'SH001',
						to_shelter: 'SH002',
						items: [{ item_id: 'item:rice', qty: 1, unit: 'kg' }]
					}
				)
			);

			expect(res.status).toBe(201);
		});

		it('allows warehouse_staff and lists transfers scoped to their shelter', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH002'],
				isSA: false,
				shelterCode: 'SH002'
			});

			const mockTransfers = [
				{
					_id: 'stock_transfer:1',
					type: 'stock_transfer',
					schema_v: 2,
					shelter_code: 'SH001',
					created_at: '2026-08-22T05:00:00.000Z',
					updated_at: '2026-08-22T05:00:00.000Z',
					created_by: 'ws_user',
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
					status: 'requested',
					timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'ws_user' } }
				}
			];
			mockList.mockResolvedValue(mockTransfers as unknown as StockTransfer[]);

			const event = createMockEvent({ status: 'requested' });
			const res = await GET(event);
			expect(res.status).toBe(200);

			const data = await res.json();
			expect(data).toEqual(mockTransfers);
			expect(mockList).toHaveBeenCalledWith({ status: 'requested' });
		});

		it('passes repeated id params through as an ids filter (#811)', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});
			mockList.mockResolvedValue([]);
			const event = createMockEvent();
			event.url.searchParams.append('id', 'stock_transfer:A');
			event.url.searchParams.append('id', 'stock_transfer:B');

			const res = await GET(event);

			expect(res.status).toBe(200);
			expect(mockList).toHaveBeenCalledWith({
				status: undefined,
				ids: ['stock_transfer:A', 'stock_transfer:B']
			});
		});

		it('rejects more id params than one request may name', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});
			const event = createMockEvent();
			for (let i = 0; i < 51; i++) event.url.searchParams.append('id', `stock_transfer:${i}`);

			const res = await GET(event);

			expect(res.status).toBe(400);
			expect(mockList).not.toHaveBeenCalled();
		});
	});

	describe('POST /api/back-office/transfer', () => {
		const validBody = {
			from_shelter: 'SH001',
			to_shelter: 'SH002',
			items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
		};

		it('creates a new requested transfer successfully', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const mockCreatedTransfer = {
				_id: 'stock_transfer:01F8MECHJCZGWFCP',
				type: 'stock_transfer',
				schema_v: 2,
				shelter_code: 'SH001',
				created_at: '2026-08-22T05:00:00.000Z',
				updated_at: '2026-08-22T05:00:00.000Z',
				created_by: 'ws_user',
				status: 'requested',
				timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'ws_user' } },
				...validBody,
				items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }]
			};
			mockCreate.mockResolvedValue(mockCreatedTransfer as unknown as StockTransfer);

			const event = createMockEvent({}, validBody);
			const res = await POST(event);
			expect(res.status).toBe(201);

			const data = await res.json();
			expect(data).toEqual(mockCreatedTransfer);
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({ from_shelter: 'SH001', to_shelter: 'SH002' }),
				{ shelterCode: 'SH001', createdBy: 'ws_user' }
			);
		});

		it('returns 400 on validation failure', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { to_shelter: 'SH002' });
			const res = await POST(event);
			expect(res.status).toBe(400);
			expect(mockCreate).not.toHaveBeenCalled();
		});

		it('returns 422 when from_shelter does not match the creating shelter scope', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { ...validBody, from_shelter: 'SH999' });
			const res = await POST(event);
			expect(res.status).toBe(422);
			expect(mockCreate).not.toHaveBeenCalled();
		});

		it('returns 422 when from_shelter equals to_shelter', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'ws_user',
				roles: ['warehouse_staff', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent({}, { ...validBody, to_shelter: 'SH001' });
			const res = await POST(event);
			expect(res.status).toBe(422);
			expect(mockCreate).not.toHaveBeenCalled();
		});
	});
});
