import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RequirementGroupRemoteRepository } from './requirement-group.remote';
import { FoodSphereRemoteRepository } from './food-sphere.remote';
import { ReplenishmentPolicyRemoteRepository } from './replenishment-policy.remote';
import type { RequirementGroup } from '../domain/requirement-group';
import type { FoodSphereStandard } from '../domain/food-sphere';
import type { ReplenishmentPolicy } from '../domain/replenishment-policy';
import * as couchDb from '$lib/db/couch-db';

describe('SOP Parameters Soft Delete Remote Repositories', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('RequirementGroupRemoteRepository', () => {
		it('falls back to status: "active" when doc.status is undefined on get and listAll', async () => {
			const repo = new RequirementGroupRemoteRepository();
			const rawDoc = {
				_id: 'requirement_group:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'requirement_group' as const,
				schema_v: 1 as const,
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				rawDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			vi.spyOn(couchDb, 'allDocsByType').mockResolvedValue([
				rawDoc
			] as unknown as RequirementGroup[]);

			const fetched = await repo.get('requirement_group:FOOD_ENERGY');
			expect(fetched?.status).toBe('active');

			const all = await repo.listAll();
			expect(all[0].status).toBe('active');
		});

		it('delete performs soft-delete by setting status to inactive', async () => {
			const repo = new RequirementGroupRemoteRepository();
			const existingDoc = {
				_id: 'requirement_group:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'requirement_group' as const,
				schema_v: 1 as const,
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				status: 'active' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			const putSpy = vi
				.spyOn(couchDb, 'putDoc')
				.mockImplementation(
					async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
				);

			await repo.delete('requirement_group:FOOD_ENERGY');
			expect(putSpy).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					_id: 'requirement_group:FOOD_ENERGY',
					status: 'inactive'
				})
			);
		});

		it('setStatus allows reactivating an inactive requirement group', async () => {
			const repo = new RequirementGroupRemoteRepository();
			const existingDoc = {
				_id: 'requirement_group:FOOD_ENERGY',
				_rev: '2-rev',
				type: 'requirement_group' as const,
				schema_v: 1 as const,
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				status: 'inactive' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			const putSpy = vi
				.spyOn(couchDb, 'putDoc')
				.mockImplementation(
					async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
				);

			const updated = await repo.setStatus('requirement_group:FOOD_ENERGY', 'active');
			expect(updated?.status).toBe('active');
			expect(putSpy).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					_id: 'requirement_group:FOOD_ENERGY',
					status: 'active'
				})
			);
		});
	});

	describe('FoodSphereRemoteRepository', () => {
		it('falls back to status: "active" when doc.status is undefined on get and listAll', async () => {
			const repo = new FoodSphereRemoteRepository();
			const rawDoc = {
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'food_sphere_standard' as const,
				schema_v: 1 as const,
				target_segment: 'ALL' as const,
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				effective_date: '2026-07-16',
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				rawDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			vi.spyOn(couchDb, 'allDocsByType').mockResolvedValue([
				rawDoc
			] as unknown as FoodSphereStandard[]);

			const fetched = await repo.get('food_sphere_standard:ALL:FOOD_ENERGY');
			expect(fetched?.status).toBe('active');

			const all = await repo.listAll();
			expect(all[0].status).toBe('active');
		});

		it('delete performs soft-delete by setting status to inactive', async () => {
			const repo = new FoodSphereRemoteRepository();
			const existingDoc = {
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'food_sphere_standard' as const,
				schema_v: 1 as const,
				target_segment: 'ALL' as const,
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				effective_date: '2026-07-16',
				status: 'active' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			const putSpy = vi
				.spyOn(couchDb, 'putDoc')
				.mockImplementation(
					async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
				);

			await repo.delete('food_sphere_standard:ALL:FOOD_ENERGY');
			expect(putSpy).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
					status: 'inactive'
				})
			);
		});

		it('setStatus allows reactivating a food sphere standard', async () => {
			const repo = new FoodSphereRemoteRepository();
			const existingDoc = {
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				_rev: '2-rev',
				type: 'food_sphere_standard' as const,
				schema_v: 1 as const,
				target_segment: 'ALL' as const,
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				effective_date: '2026-07-16',
				status: 'inactive' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			vi.spyOn(couchDb, 'putDoc').mockImplementation(
				async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
			);

			const updated = await repo.setStatus('food_sphere_standard:ALL:FOOD_ENERGY', 'active');
			expect(updated?.status).toBe('active');
		});
	});

	describe('ReplenishmentPolicyRemoteRepository', () => {
		it('falls back to status: "active" when doc.status is undefined on get and listAll', async () => {
			const repo = new ReplenishmentPolicyRemoteRepository();
			const rawDoc = {
				_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'replenishment_policy' as const,
				schema_v: 1 as const,
				scope_type: 'REQUIREMENT_GROUP' as const,
				target_id: 'FOOD_ENERGY',
				lead_time_days: 2,
				review_period_days: 3,
				safety_days: 2,
				min_doc_days: 2,
				max_doc_days: 30,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				rawDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			vi.spyOn(couchDb, 'allDocsByType').mockResolvedValue([
				rawDoc
			] as unknown as ReplenishmentPolicy[]);

			const fetched = await repo.get('replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY');
			expect(fetched?.status).toBe('active');

			const all = await repo.listAll();
			expect(all[0].status).toBe('active');
		});

		it('delete performs soft-delete by setting status to inactive', async () => {
			const repo = new ReplenishmentPolicyRemoteRepository();
			const existingDoc = {
				_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
				_rev: '1-rev',
				type: 'replenishment_policy' as const,
				schema_v: 1 as const,
				scope_type: 'REQUIREMENT_GROUP' as const,
				target_id: 'FOOD_ENERGY',
				lead_time_days: 2,
				review_period_days: 3,
				safety_days: 2,
				min_doc_days: 2,
				max_doc_days: 30,
				status: 'active' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			const putSpy = vi
				.spyOn(couchDb, 'putDoc')
				.mockImplementation(
					async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
				);

			await repo.delete('replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY');
			expect(putSpy).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
					status: 'inactive'
				})
			);
		});

		it('setStatus allows reactivating a replenishment policy', async () => {
			const repo = new ReplenishmentPolicyRemoteRepository();
			const existingDoc = {
				_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
				_rev: '2-rev',
				type: 'replenishment_policy' as const,
				schema_v: 1 as const,
				scope_type: 'REQUIREMENT_GROUP' as const,
				target_id: 'FOOD_ENERGY',
				lead_time_days: 2,
				review_period_days: 3,
				safety_days: 2,
				min_doc_days: 2,
				max_doc_days: 30,
				status: 'inactive' as const,
				source: 'SPHERE_BASELINE' as const,
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			vi.spyOn(couchDb, 'getDoc').mockResolvedValue(
				existingDoc as unknown as Awaited<ReturnType<typeof couchDb.getDoc>>
			);
			vi.spyOn(couchDb, 'putDoc').mockImplementation(
				async (_db, doc) => doc as unknown as ReturnType<typeof couchDb.putDoc>
			);

			const updated = await repo.setStatus(
				'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
				'active'
			);
			expect(updated?.status).toBe('active');
		});
	});
});
