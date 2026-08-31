import { describe, it, expect } from 'vitest';
import { SOP_RATIO_KEYS, SOP_RATIO_KIND } from '$lib/features/sop-ratios/server';
import { buildValidateDocUpdate } from './shelter-access-design';

type UserCtx = { name: string; roles: string[] };
type Doc = Record<string, unknown>;
type ValidateFn = (newDoc: Doc, oldDoc: Doc | null, userCtx: UserCtx) => void;

/** Compile the generated source so the rules are exercised, not just string-matched. */
function compile(code = 'SH001'): ValidateFn {
	return new Function(`return ${buildValidateDocUpdate(code)}`)() as ValidateFn;
}

/**
 * CouchDB validators reject by throwing a plain `{ forbidden }` object, not an
 * Error — `expect(...).toThrow(/re/)` cannot read those, so assert the field.
 */
function expectForbidden(run: () => void, match: RegExp): void {
	try {
		run();
	} catch (e) {
		expect((e as { forbidden?: string }).forbidden ?? String(e)).toMatch(match);
		return;
	}
	throw new Error(`Expected a forbidden error matching ${match}, but nothing was thrown`);
}

const WAREHOUSE: UserCtx = { name: 'ws', roles: ['shelter:SH001', 'warehouse_staff'] };
const REGISTRATION: UserCtx = { name: 'reg', roles: ['shelter:SH001', 'registration_staff'] };
const KITCHEN: UserCtx = { name: 'kt', roles: ['shelter:SH001', 'kitchen_staff'] };

const envelope = {
	schema_v: 2,
	shelter_code: 'SH001',
	created_at: '2026-07-22T00:00:00.000Z',
	updated_at: '2026-07-22T00:00:00.000Z',
	created_by: 'ws'
};

const ledger = (over: Doc = {}): Doc => ({
	_id: 'stock_ledger:01J',
	type: 'stock_ledger',
	item_id: 'item:01H',
	qty: '10',
	unit: 'kg',
	reason: 'donation',
	...envelope,
	...over
});

const donation = (over: Doc = {}): Doc => ({
	_id: 'donation:01J',
	type: 'donation',
	status: 'declared',
	...envelope,
	schema_v: 3,
	...over
});

const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '1']));
const stock = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '1000']));
const asOf = '2026-08-17T10:00:00.000Z';
const resourceInputs = SOP_RATIO_KEYS.map((key) => ({
	key,
	kind: SOP_RATIO_KIND[key],
	ratio: '1',
	have: '1000'
}));
const dailyResults = SOP_RATIO_KEYS.map((key, ordinal) => ({
	ordinal,
	key,
	kind: SOP_RATIO_KIND[key],
	input_valid: true,
	ratio: '1',
	need: '500',
	have: '1000',
	gap: '-500',
	status: 'surplus',
	data_status: 'complete',
	as_of: asOf
}));
const horizonResults = SOP_RATIO_KEYS.map((key) => ({
	key,
	kind: SOP_RATIO_KIND[key],
	daily_need: '500',
	horizon_need: '7000',
	have: '1000',
	horizon_gap: '6000'
}));
const simulationResult = (shelterCode = 'SH001') => ({
	input: {
		name: 'Flood 14 days',
		occupancy: 2000,
		days: 14,
		ratio_overrides: {}
	},
	snapshot: {
		shelter_code: shelterCode,
		as_of: asOf,
		formula_v: '2.0.0',
		profile: {
			effective_id: 'sop_profile:01K1ABCDEFGHJKMNPQRSTVWXYZ',
			effective_version: 1,
			ratio_source: 'master',
			base_profile_id: null,
			override_id: null,
			override_version: null
		},
		current_occupancy: 500,
		current_ratios: ratios,
		resource_inputs: resourceInputs,
		stock_snapshot: stock
	},
	current: { occupancy: 500, ratios, daily_results: dailyResults, horizon_results: horizonResults },
	scenario: {
		occupancy: 2000,
		ratios,
		daily_results: dailyResults,
		horizon_results: horizonResults
	},
	comparison: SOP_RATIO_KEYS.map((key) => ({
		key,
		kind: SOP_RATIO_KIND[key],
		current_ratio: '1',
		scenario_ratio: '1',
		ratio_overridden: false,
		current_daily_need: '500',
		scenario_daily_need: '500',
		current_horizon_need: '7000',
		scenario_horizon_need: '7000',
		have: '1000',
		current_horizon_gap: '6000',
		scenario_horizon_gap: '6000',
		need_delta: '0',
		gap_delta: '0',
		current_data_status: 'complete',
		scenario_data_status: 'complete'
	}))
});

describe('buildValidateDocUpdate', () => {
	it('includes audit in the allowed doc type whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		expect(validateFn).toContain("'audit'");
		expect(validateFn).toContain("'purchase'");
		expect(validateFn).toContain("'referral'");
	});

	it('includes catalog-related doc types in the allowed whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		expect(validateFn).toContain("'item_category'");
		expect(validateFn).toContain("'item_master'");
		expect(validateFn).toContain("'recipe'");
	});

	it('includes daily_calc in the allowed doc type whitelist for on-demand writes', () => {
		expect(buildValidateDocUpdate('SH001')).toContain("'daily_calc'");
	});

	it('allows managers to create/delete immutable simulations and rejects staff or updates', () => {
		const simulation = {
			...envelope,
			schema_v: 1,
			_id: 'simulation:01K1ABCDEFGHJKMNPQRSTVWXYZ',
			type: 'simulation',
			created_by: 'sm',
			result: simulationResult()
		};
		expect(() =>
			compile()(simulation, null, {
				name: 'sm',
				roles: ['shelter:SH001', 'shelter_manager']
			})
		).not.toThrow();
		expectForbidden(
			() => compile()(simulation, null, REGISTRATION),
			/Only shelter managers or system admins/
		);
		expectForbidden(
			() =>
				compile()(simulation, simulation, {
					name: 'sm',
					roles: ['shelter:SH001', 'shelter_manager']
				}),
			/Saved simulations are immutable/
		);
		expect(() =>
			compile()({ _id: simulation._id, _rev: '1-simulation', _deleted: true }, simulation, {
				name: 'sm',
				roles: ['shelter:SH001', 'shelter_manager']
			})
		).not.toThrow();
		expectForbidden(
			() =>
				compile()(
					{ _id: simulation._id, _rev: '1-simulation', _deleted: true },
					simulation,
					REGISTRATION
				),
			/Only shelter managers or system admins can delete simulations/
		);
	});

	it('rejects forged, malformed, or cross-shelter simulation evidence', () => {
		const valid = {
			...envelope,
			_id: 'simulation:01K1ABCDEFGHJKMNPQRSTVWXYZ',
			type: 'simulation',
			schema_v: 1,
			created_by: 'sm',
			result: simulationResult()
		};
		const ctx = { name: 'sm', roles: ['shelter:SH001', 'shelter_manager'] };
		expectForbidden(
			() => compile()({ ...valid, created_by: 'forged' }, null, ctx),
			/authenticated user/
		);
		expectForbidden(() => compile()({ ...valid, result: {} }, null, ctx), /shape is incomplete/);
		expectForbidden(
			() => compile()({ ...valid, result: simulationResult('SH002') }, null, ctx),
			/snapshot shelter/
		);
		expectForbidden(
			() => compile()({ ...valid, _id: 'simulation:not-a-ulid' }, null, ctx),
			/simulation id/
		);
		const badOrder = structuredClone(simulationResult());
		badOrder.comparison[0].key = SOP_RATIO_KEYS[1];
		expectForbidden(() => compile()({ ...valid, result: badOrder }, null, ctx), /resource order/);
		const badOccupancy = structuredClone(simulationResult());
		badOccupancy.scenario.occupancy = 1999;
		expectForbidden(
			() => compile()({ ...valid, result: badOccupancy }, null, ctx),
			/occupancy evidence/
		);
		for (const field of ['as_of', 'formula_v', 'profile', 'stock_snapshot'] as const) {
			const incomplete = structuredClone(simulationResult());
			delete (incomplete.snapshot as Record<string, unknown>)[field];
			expectForbidden(
				() => compile()({ ...valid, result: incomplete }, null, ctx),
				/shape is incomplete/
			);
		}
		const badKind = structuredClone(simulationResult());
		badKind.snapshot.resource_inputs[0].kind = 'divide';
		expectForbidden(() => compile()({ ...valid, result: badKind }, null, ctx), /resource order/);
		const missingResultEvidence = structuredClone(simulationResult());
		delete (missingResultEvidence.comparison[0] as Record<string, unknown>).scenario_data_status;
		expectForbidden(
			() => compile()({ ...valid, result: missingResultEvidence }, null, ctx),
			/resource order/
		);
		const extraNestedField = structuredClone(simulationResult());
		(extraNestedField.snapshot as Record<string, unknown>).unexpected = true;
		expectForbidden(
			() => compile()({ ...valid, result: extraNestedField }, null, ctx),
			/shape is incomplete/
		);
	});

	// CR-032: purchase docs are written to shelter dbs, so the server-side
	// whitelist must accept them or every write is rejected as forbidden.
	it('includes purchase in the allowed doc type whitelist', () => {
		expect(buildValidateDocUpdate('SH001')).toContain("'purchase'");
	});

	// People registration writes household/medical/screening/movement/image after
	// createEvacuee — without these, session staff see a failed toast while an
	// orphan pre_registered evacuee remains in the DB.
	it('includes people-plane doc types in the allowed whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		for (const type of ['household', 'medical', 'screening', 'movement', 'image'] as const) {
			expect(validateFn).toContain(`'${type}'`);
		}
	});

	it('includes sop and food sphere doc types in the allowed whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		for (const type of [
			'requirement_group',
			'food_sphere_standard',
			'replenishment_policy',
			'sop_override'
		] as const) {
			expect(validateFn).toContain(`'${type}'`);
		}
	});

	// CR-071 / T-72: the people importer writes its batch log to the shelter db
	// (its results[] carry evacuee names). Without the whitelist entry the whole
	// import succeeds but the history write 403s.
	it('accepts a people_import_log write from registration staff', () => {
		expect(() =>
			compile()(
				{
					_id: 'people_import_log:01J',
					type: 'people_import_log',
					...envelope,
					schema_v: 1,
					source: 'people',
					filename: 'households.xlsx',
					imported_by: 'reg',
					total_rows: 3,
					success_count: 3,
					skipped_count: 0,
					error_count: 0,
					created_people: 7,
					skipped_people: 0,
					results: [],
					started_at: '2026-08-22T00:00:00.000Z',
					finished_at: '2026-08-22T00:00:01.000Z'
				},
				null,
				REGISTRATION
			)
		).not.toThrow();
	});

	it('rejects update of an existing people_import_log (append-only)', () => {
		const log = {
			...envelope,
			schema_v: 1,
			_id: 'people_import_log:01J',
			type: 'people_import_log',
			source: 'people',
			filename: 'households.xlsx',
			imported_by: 'reg'
		};
		expectForbidden(
			() => compile()({ ...log, success_count: 9 }, log, REGISTRATION),
			/Cannot update append-only people_import_log/
		);
	});

	it('rejects delete of an existing people_import_log (append-only)', () => {
		const log = {
			...envelope,
			schema_v: 1,
			_id: 'people_import_log:01J',
			type: 'people_import_log',
			source: 'people',
			filename: 'households.xlsx',
			imported_by: 'reg'
		};
		expectForbidden(
			() => compile()({ _id: log._id, _rev: '1-a', _deleted: true }, log, REGISTRATION),
			/Cannot delete append-only people_import_log/
		);
	});

	it('accepts household create from registration staff', () => {
		expect(() =>
			compile()(
				{
					_id: 'household:01J',
					type: 'household',
					...envelope,
					schema_v: 4,
					label: 'ครอบครัวทดสอบ',
					status: 'pre_registered'
				},
				null,
				REGISTRATION
			)
		).not.toThrow();
	});

	it('rejects update of an existing movement (append-only)', () => {
		const movement = {
			...envelope,
			schema_v: 1,
			_id: 'movement:01J',
			type: 'movement',
			evacuee_id: 'evacuee:01J',
			action: 'check_in'
		};
		expectForbidden(
			() => compile()({ ...movement, zone: 'A' }, movement, REGISTRATION),
			/Cannot update append-only movement/
		);
	});

	it('accepts a new stock_ledger entry from warehouse staff', () => {
		expect(() => compile()(ledger(), null, WAREHOUSE)).not.toThrow();
	});

	it('rejects a doc whose shelter_code belongs to another shelter', () => {
		expectForbidden(
			() => compile()(ledger({ shelter_code: 'SH002' }), null, WAREHOUSE),
			/shelter_code must be SH001/
		);
	});

	describe('append-only (schema.md §6.2)', () => {
		it('rejects updating an existing stock_ledger', () => {
			expectForbidden(
				() => compile()(ledger({ qty: '99' }), ledger(), WAREHOUSE),
				/Cannot update append-only stock_ledger/
			);
		});

		it('rejects deleting an existing stock_ledger', () => {
			expectForbidden(
				() => compile()({ _id: 'stock_ledger:01J', _deleted: true }, ledger(), WAREHOUSE),
				/Cannot delete append-only stock_ledger/
			);
		});

		it('rejects updating an existing audit entry', () => {
			const audit = { ...envelope, schema_v: 1, _id: 'audit:01J', type: 'audit' };
			expectForbidden(
				() => compile()({ ...audit, reason: 'edited' }, audit, WAREHOUSE),
				/Cannot update append-only audit/
			);
		});
	});

	describe('donation status is forward-only (schema.md §2.3)', () => {
		it('allows declared → received', () => {
			expect(() =>
				compile()(donation({ status: 'received' }), donation(), WAREHOUSE)
			).not.toThrow();
		});

		it('rejects received → declared', () => {
			expectForbidden(
				() =>
					compile()(donation({ status: 'declared' }), donation({ status: 'received' }), WAREHOUSE),
				/Cannot revert donation status back to declared/
			);
		});
	});

	// Module D (kitchen) was missing from the whitelist entirely — kitchen_staff
	// could never actually write any of these without an _admin session, even
	// though requireKitchen() lets them into the UI (bug found + fixed alongside
	// CR-080's gas_ledger addition).
	describe('kitchen doc types (schema.md §2.5-§2.7.2)', () => {
		it('includes every kitchen doc type in the allowed whitelist', () => {
			const validateFn = buildValidateDocUpdate('SH001');
			for (const type of [
				'meal_plan',
				'kitchen_requisition',
				'meal_service',
				'gas_cylinder_type',
				'gas_ledger'
			] as const) {
				expect(validateFn).toContain(`'${type}'`);
			}
		});

		it('accepts a new meal_plan from kitchen_staff', () => {
			expect(() =>
				compile()(
					{
						_id: 'meal_plan:01J',
						type: 'meal_plan',
						...envelope,
						date: '2026-08-22',
						meal: 'lunch',
						headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
						recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 1000 }],
						status: 'draft'
					},
					null,
					KITCHEN
				)
			).not.toThrow();
		});

		it('accepts a new gas_cylinder_type from kitchen_staff', () => {
			expect(() =>
				compile()(
					{
						_id: 'gas_cylinder_type:01J',
						type: 'gas_cylinder_type',
						...envelope,
						schema_v: 2,
						name: 'ถังทดสอบ',
						capacity_kg: '15',
						burn_rate_kg_per_hour: '0.5',
						time_multiplier: '1'
					},
					null,
					KITCHEN
				)
			).not.toThrow();
		});

		it('accepts a new gas_ledger entry from kitchen_staff', () => {
			expect(() =>
				compile()(
					{
						_id: 'gas_ledger:01J',
						type: 'gas_ledger',
						...envelope,
						schema_v: 1,
						cylinder_id: 'gas_cylinder_type:01J',
						qty_kg: '-2',
						reason: 'consumption',
						ref_id: null,
						occurred_at: envelope.created_at
					},
					null,
					KITCHEN
				)
			).not.toThrow();
		});

		it.each(['kitchen_requisition', 'meal_service', 'gas_ledger'])(
			'rejects updating an existing %s (append-only)',
			(type) => {
				const doc = { ...envelope, schema_v: 1, _id: `${type}:01J`, type };
				expectForbidden(
					() => compile()({ ...doc, touched: true }, doc, KITCHEN),
					new RegExp(`Cannot update append-only ${type}`)
				);
			}
		);

		it.each(['kitchen_requisition', 'meal_service', 'gas_ledger'])(
			'rejects deleting an existing %s (append-only)',
			(type) => {
				const doc = { ...envelope, schema_v: 1, _id: `${type}:01J`, type };
				expectForbidden(
					() => compile()({ _id: `${type}:01J`, _deleted: true }, doc, KITCHEN),
					new RegExp(`Cannot delete append-only ${type}`)
				);
			}
		);

		it('allows updating an existing gas_cylinder_type (mutable, LWW)', () => {
			const doc = {
				...envelope,
				schema_v: 2,
				_id: 'gas_cylinder_type:01J',
				type: 'gas_cylinder_type',
				name: 'ถังทดสอบ',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5',
				time_multiplier: '1'
			};
			expect(() => compile()({ ...doc, capacity_kg: '20' }, doc, KITCHEN)).not.toThrow();
		});
	});

	describe('stock_ledger role gate', () => {
		it('rejects a writer without a warehouse/manager role', () => {
			expectForbidden(
				() => compile()(ledger(), null, REGISTRATION),
				/Only warehouse staff or managers can write stock ledger/
			);
		});

		it('allows shelter_manager', () => {
			expect(() =>
				compile()(ledger(), null, { name: 'sm', roles: ['shelter:SH001', 'shelter_manager'] })
			).not.toThrow();
		});

		it('never blocks the CouchDB server admin (provisioning/seed)', () => {
			expect(() =>
				compile()(ledger({ shelter_code: 'SH999' }), ledger(), {
					name: 'admin',
					roles: ['_admin']
				})
			).not.toThrow();
		});

		it('rejects distribute stock_ledger from shelter_manager (requires warehouse_staff or system_admin)', () => {
			const distLedger = ledger({
				qty: '-10',
				reason: 'distribute',
				ref_id: 'distribution_batch:01J',
				lot_ref: 'stock_ledger:01J'
			});
			expectForbidden(
				() =>
					compile()(distLedger, null, { name: 'sm', roles: ['shelter:SH001', 'shelter_manager'] }),
				/Only warehouse staff or system admin can write distribute stock ledger/
			);
		});

		it('allows distribute stock_ledger from warehouse_staff', () => {
			const distLedger = ledger({
				qty: '-10',
				reason: 'distribute',
				ref_id: 'distribution_batch:01J',
				lot_ref: 'stock_ledger:01J'
			});
			expect(() => compile()(distLedger, null, WAREHOUSE)).not.toThrow();
		});

		it('enforces distribute ref, lot, qty, and old-document append-only invariants', () => {
			const valid = ledger({
				qty: '-1.5',
				reason: 'distribute',
				ref_id: 'distribution_batch:01J',
				lot_ref: 'stock_ledger:01J'
			});
			expectForbidden(
				() => compile()({ ...valid, ref_id: null }, null, WAREHOUSE),
				/distribution_batch ref_id/
			);
			expectForbidden(
				() => compile()({ ...valid, ref_id: 'donation:01J' }, null, WAREHOUSE),
				/distribution_batch ref_id/
			);
			expectForbidden(
				() => compile()({ ...valid, lot_ref: undefined }, null, WAREHOUSE),
				/physical stock_ledger lot_ref/
			);
			expectForbidden(
				() => compile()({ ...valid, lot_ref: 'lot:01J' }, null, WAREHOUSE),
				/physical stock_ledger lot_ref/
			);
			expectForbidden(() => compile()({ ...valid, qty: '1' }, null, WAREHOUSE), /negative decimal/);
			expectForbidden(
				() => compile()({ ...valid, type: 'donation' }, valid, WAREHOUSE),
				/append-only/
			);
		});
	});

	describe('distribution doc types access rules', () => {
		const MANAGER: UserCtx = { name: 'mgr', roles: ['shelter:SH001', 'shelter_manager'] };
		const ADMIN: UserCtx = { name: 'admin', roles: ['system_admin'] };
		const UNAUTHORIZED: UserCtx = { name: 'unknown', roles: ['shelter:SH001'] };

		const reqDoc = (over: Doc = {}): Doc => ({
			_id: 'distribution_request:01J',
			type: 'distribution_request',
			status: 'pending',
			purpose: 'Flood relief',
			items: [{ item_id: 'item:soap', requested_qty: '10', unit: 'bar' }],
			...envelope,
			schema_v: 1,
			...over
		});

		const batchDoc = (over: Doc = {}): Doc => ({
			_id: 'distribution_batch:01J',
			type: 'distribution_batch',
			request_id: 'distribution_request:01J',
			status: 'activating',
			items: [{ item_id: 'item:soap', allocated_qty: '10', unit: 'bar' }],
			allocations: [{ item_id: 'item:soap', lot_ref: 'stock_ledger:01J', qty: '10' }],
			...envelope,
			schema_v: 1,
			...over
		});

		const resDoc = (over: Doc = {}): Doc => ({
			_id: 'stock_lot_reservation:hash123',
			type: 'stock_lot_reservation',
			lot_ref: 'stock_ledger:01J',
			pending_claims: [],
			...envelope,
			schema_v: 1,
			...over
		});

		it('allows registration_staff to create pending distribution_request', () => {
			expect(() => compile()(reqDoc(), null, REGISTRATION)).not.toThrow();
		});

		it.each([
			['registration_staff', REGISTRATION],
			['shelter_manager', MANAGER],
			['system_admin', ADMIN]
		])('allows %s to cancel a pending distribution_request', (_role, userCtx) => {
			const pending = reqDoc();
			expect(() => compile()(reqDoc({ status: 'cancelled' }), pending, userCtx)).not.toThrow();
		});

		it.each([
			['warehouse_staff', WAREHOUSE],
			['kitchen_staff', KITCHEN],
			['missing role', UNAUTHORIZED]
		])('rejects %s directly cancelling a pending distribution_request', (_role, userCtx) => {
			const pending = reqDoc();
			expectForbidden(
				() => compile()(reqDoc({ status: 'cancelled' }), pending, userCtx),
				/Only authorized request editors can cancel distribution requests/
			);
		});

		it('allows valid cancellation with preserved request content and provenance', () => {
			const pending = reqDoc({
				purpose: 'Standard Issue',
				note: 'Initial note',
				requested_by: 'staff-1',
				requested_at: '2026-08-30T10:00:00.000Z',
				created_by: 'staff-1',
				created_at: '2026-08-30T10:00:00.000Z',
				active_headcount_snapshot: '100',
				buffer_percent: 10
			});
			expect(() =>
				compile()(
					reqDoc({
						...pending,
						status: 'cancelled',
						updated_at: '2026-08-30T10:30:00.000Z'
					}),
					pending,
					REGISTRATION
				)
			).not.toThrow();
		});

		it.each([
			['note', { note: 'Tampered note' }],
			['removing note', { note: undefined }],
			['adding note when previously undefined', { note: 'New note' }],
			['requested_by', { requested_by: 'imposter' }],
			['requested_at', { requested_at: '2026-08-31T00:00:00.000Z' }],
			['created_by', { created_by: 'attacker' }],
			['created_at', { created_at: '2026-08-31T00:00:00.000Z' }],
			['purpose', { purpose: 'Tampered purpose' }],
			['active_headcount_snapshot', { active_headcount_snapshot: '999' }],
			['buffer_percent', { buffer_percent: 5 }],
			[
				'items',
				{
					items: [
						{
							item_id: 'item:tampered',
							requested_qty: '99',
							unit: 'pcs',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '99'
						}
					]
				}
			]
		])('rejects modifying %s during pending -> cancelled', (_field, override) => {
			const pending = reqDoc({
				purpose: 'Original purpose',
				note: _field === 'adding note when previously undefined' ? undefined : 'Original note',
				requested_by: 'original-requester',
				requested_at: '2026-08-30T10:00:00.000Z',
				created_by: 'original-creator',
				created_at: '2026-08-30T10:00:00.000Z',
				active_headcount_snapshot: '100',
				buffer_percent: 10
			});
			const cancelled = reqDoc({
				...pending,
				status: 'cancelled',
				...override
			});
			expectForbidden(
				() => compile()(cancelled, pending, REGISTRATION),
				/Cannot modify request content or provenance while cancelling distribution_request/
			);
		});

		it.each([
			['approval_operation_id', { approval_operation_id: '01JOP' }],
			['approved_by', { approved_by: 'warehouse-1' }],
			['approved_at', { approved_at: '2026-08-30T11:00:00.000Z' }],
			['batch_id', { batch_id: 'distribution_batch:01JBATCH' }],
			['rejected_by', { rejected_by: 'warehouse-1' }],
			['rejected_at', { rejected_at: '2026-08-30T11:00:00.000Z' }],
			['rejection_reason', { rejection_reason: 'Tampered reason' }]
		])('rejects injecting %s during pending -> cancelled', (_field, override) => {
			const pending = reqDoc();
			const cancelled = reqDoc({
				...pending,
				status: 'cancelled',
				...override
			});
			expectForbidden(
				() => compile()(cancelled, pending, REGISTRATION),
				/Cannot inject approval or rejection metadata while cancelling distribution_request/
			);
		});

		it.each(['approving', 'approved', 'rejected'] as const)('rejects %s -> cancelled', (status) => {
			const current = reqDoc({
				status,
				...(status === 'approving' ? { approval_operation_id: '01JOP' } : {})
			});
			expectForbidden(
				() => compile()(reqDoc({ ...current, status: 'cancelled' }), current, REGISTRATION),
				/Invalid distribution_request transition|Terminal distribution_request/
			);
		});

		it('rejects mutations of a cancelled distribution_request', () => {
			const cancelled = reqDoc({ status: 'cancelled', purpose: 'Original' });
			expectForbidden(
				() =>
					compile()(reqDoc({ status: 'cancelled', purpose: 'Tampered' }), cancelled, REGISTRATION),
				/Terminal distribution_request/
			);
		});

		it('rejects registration_staff transitioning distribution_request to approving', () => {
			const pending = reqDoc();
			const approving = reqDoc({ status: 'approving', approval_operation_id: '01JOP' });
			expectForbidden(
				() => compile()(approving, pending, REGISTRATION),
				/Only warehouse staff or system admin can approve or reject distribution requests/
			);
		});

		it('allows warehouse_staff transitioning distribution_request from pending to approving to approved', () => {
			const pending = reqDoc();
			const approving = reqDoc({ status: 'approving', approval_operation_id: '01JOP' });
			const approved = reqDoc({
				status: 'approved',
				approval_operation_id: '01JOP',
				batch_id: 'distribution_batch:01J'
			});
			expect(() => compile()(approving, pending, WAREHOUSE)).not.toThrow();
			expect(() => compile()(approved, approving, WAREHOUSE)).not.toThrow();
		});

		it('rejects illegal transition from pending directly to approved', () => {
			const pending = reqDoc();
			const approved = reqDoc({ status: 'approved', batch_id: 'distribution_batch:01J' });
			expectForbidden(
				() => compile()(approved, pending, WAREHOUSE),
				/Invalid distribution_request transition from pending to approved/
			);
		});

		it('rejects approved distribution_request without batch_id', () => {
			const approving = reqDoc({ status: 'approving', approval_operation_id: '01JOP' });
			const approvedNoBatch = reqDoc({ status: 'approved', approval_operation_id: '01JOP' });
			expectForbidden(
				() => compile()(approvedNoBatch, approving, WAREHOUSE),
				/Approved distribution_request must include valid batch_id/
			);
		});

		it('rejects distribution_batch creation from registration_staff', () => {
			expectForbidden(
				() => compile()(batchDoc(), null, REGISTRATION),
				/Only warehouse staff or system admin can manage distribution batches/
			);
		});

		it('allows warehouse_staff to create activating batch and transition to active', () => {
			const activating = batchDoc();
			const active = batchDoc({ status: 'active' });
			expect(() => compile()(activating, null, WAREHOUSE)).not.toThrow();
			expect(() => compile()(active, activating, WAREHOUSE)).not.toThrow();
		});

		it('rejects modifying request_id on existing batch', () => {
			const activating = batchDoc({ status: 'activating' });
			const tampered = batchDoc({
				status: 'activating',
				request_id: 'distribution_request:01JOTHER'
			});
			expectForbidden(
				() => compile()(tampered, activating, WAREHOUSE),
				/Cannot change request_id on distribution_batch/
			);
		});

		it('rejects stock_lot_reservation mutation from non-warehouse staff', () => {
			expectForbidden(
				() => compile()(resDoc(), null, REGISTRATION),
				/Only warehouse staff or system admin can manage stock lot reservations/
			);
		});

		it('allows warehouse_staff to manage stock_lot_reservation', () => {
			expect(() => compile()(resDoc(), null, WAREHOUSE)).not.toThrow();
		});

		it('rejects malformed reservation claims and non-authorized pending request edits', () => {
			expectForbidden(
				() =>
					compile()(
						resDoc({
							pending_claims: [
								{
									operation_id: 'op',
									request_id: 'distribution_request:01J',
									batch_id: 'distribution_batch:01J',
									item_id: 'item:soap',
									lot_ref: 'stock_ledger:OTHER',
									qty: '1',
									claimed_at: '2026-08-29T00:00:00.000Z'
								}
							]
						}),
						null,
						WAREHOUSE
					),
				/invalid pending claim/
			);
			expectForbidden(() => compile()(reqDoc(), null, KITCHEN), /Only registration staff/);
		});

		it('rejects modifying purpose, headcount, buffer, or items on non-pending request', () => {
			const approving = reqDoc({
				status: 'approving',
				approval_operation_id: '01JOP',
				purpose: 'Initial',
				active_headcount_snapshot: '50',
				buffer_percent: 10
			});

			expectForbidden(
				() => compile()({ ...approving, purpose: 'Changed' }, approving, WAREHOUSE),
				/Cannot modify purpose on non-pending distribution_request/
			);
			expectForbidden(
				() => compile()({ ...approving, active_headcount_snapshot: '60' }, approving, WAREHOUSE),
				/Cannot modify active_headcount_snapshot on non-pending distribution_request/
			);
			expectForbidden(
				() => compile()({ ...approving, buffer_percent: 20 }, approving, WAREHOUSE),
				/Cannot modify buffer_percent on non-pending distribution_request/
			);
			expectForbidden(
				() =>
					compile()(
						{ ...approving, items: [{ item_id: 'item:other', requested_qty: '10', unit: 'bar' }] },
						approving,
						WAREHOUSE
					),
				/Cannot modify items on non-pending distribution_request/
			);
		});

		it('rejects replacing approval_operation_id during approving', () => {
			const approving = reqDoc({ status: 'approving', approval_operation_id: '01JOP1' });
			const replaced = reqDoc({ status: 'approving', approval_operation_id: '01JOP2' });
			expectForbidden(
				() => compile()(replaced, approving, WAREHOUSE),
				/Cannot replace approval_operation_id once approval is in progress/
			);
		});

		it('keeps payload and approval operation immutable through approval and rollback', () => {
			const approving = reqDoc({
				status: 'approving',
				approval_operation_id: '01JOP1',
				active_headcount_snapshot: '10',
				buffer_percent: 10
			});
			expectForbidden(
				() =>
					compile()({ ...approving, status: 'pending', purpose: 'Changed' }, approving, WAREHOUSE),
				/Cannot modify purpose/
			);
			expectForbidden(
				() =>
					compile()(
						{
							...approving,
							status: 'approved',
							approval_operation_id: '01JOP2',
							batch_id: 'distribution_batch:01J'
						},
						approving,
						WAREHOUSE
					),
				/Cannot replace approval_operation_id/
			);
			expectForbidden(
				() =>
					compile()(
						{ ...approving, status: 'pending', approval_operation_id: '01JOP2' },
						approving,
						WAREHOUSE
					),
				/Cannot replace approval_operation_id during rollback/
			);
		});

		it('rejects modifying items or allocations on distribution_batch after creation', () => {
			const activating = batchDoc();
			const modifiedItems = batchDoc({
				items: [{ item_id: 'item:soap', allocated_qty: '99', unit: 'bar' }]
			});
			const modifiedAllocs = batchDoc({
				allocations: [{ item_id: 'item:soap', lot_ref: 'stock_ledger:01J', qty: '99' }]
			});
			expectForbidden(
				() => compile()(modifiedItems, activating, WAREHOUSE),
				/Cannot modify items on distribution_batch/
			);
			expectForbidden(
				() => compile()(modifiedAllocs, activating, WAREHOUSE),
				/Cannot modify allocations on distribution_batch/
			);
		});

		it('rejects changing status of active batch', () => {
			const active = batchDoc({ status: 'active' });
			const tampered = batchDoc({ status: 'activating' });
			expectForbidden(
				() => compile()(tampered, active, WAREHOUSE),
				/Active batch status cannot be changed/
			);
		});

		it('rejects direct active batch creation', () => {
			expectForbidden(
				() => compile()(batchDoc({ status: 'active' }), null, WAREHOUSE),
				/start activating/
			);
		});
	});

	describe('distribution issue doc types access rules (Phase 3B)', () => {
		const MANAGER: UserCtx = { name: 'mgr', roles: ['shelter:SH001', 'shelter_manager'] };
		const ADMIN: UserCtx = { name: 'admin', roles: ['system_admin'] };

		const validIssue = {
			_id: 'distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0',
			type: 'distribution_issue',
			...envelope,
			batch_id: 'distribution_batch:01JABCDEFGHJKMNPQRSTVWXYZ1',
			evacuee_id: 'evacuee:01JABCDEFGHJKMNPQRSTVWXYZ2',
			item_id: 'item:blanket',
			qty: '1',
			unit: 'ผืน',
			distribution_type_snapshot: 'one_time',
			eligibility_snapshot: {
				eligible: true,
				distribution_type: 'one_time',
				decision: 'first_receipt',
				had_previous_receipt: false,
				previous_receipt_count: 0
			},
			idempotency_key: 'idem-key-1',
			distributed_at: '2026-08-31T00:00:00.000Z',
			distributed_by: 'staff-1'
		};

		const validIdempotency = {
			_id: 'distribution_issue_idempotency:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
			type: 'distribution_issue_idempotency',
			...envelope,
			batch_id: 'distribution_batch:01JABCDEFGHJKMNPQRSTVWXYZ1',
			idempotency_key: 'idem-key-1',
			issue_id: 'distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0',
			evacuee_id: 'evacuee:01JABCDEFGHJKMNPQRSTVWXYZ2',
			item_id: 'item:blanket',
			qty: '1'
		};

		const validCapacity = {
			_id: 'distribution_issue_capacity:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
			type: 'distribution_issue_capacity',
			...envelope,
			batch_id: 'distribution_batch:01JABCDEFGHJKMNPQRSTVWXYZ1',
			item_id: 'item:blanket',
			pending_claims: [
				{
					operation_id: 'op-1',
					issue_id: 'distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0',
					batch_id: 'distribution_batch:01JABCDEFGHJKMNPQRSTVWXYZ1',
					item_id: 'item:blanket',
					qty: '1',
					claimed_at: '2026-08-31T00:00:00.000Z'
				}
			]
		};

		const validGuard = {
			_id: 'distribution_one_time_guard:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
			type: 'distribution_one_time_guard',
			...envelope,
			evacuee_id: 'evacuee:01JABCDEFGHJKMNPQRSTVWXYZ2',
			item_id: 'item:blanket',
			pending_claims: [
				{
					operation_id: 'op-1',
					issue_id: 'distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0',
					evacuee_id: 'evacuee:01JABCDEFGHJKMNPQRSTVWXYZ2',
					item_id: 'item:blanket',
					claimed_at: '2026-08-31T00:00:00.000Z'
				}
			]
		};

		it('allows registration_staff, shelter_manager, and system_admin to create distribution_issue', () => {
			expect(() => compile()(validIssue, null, REGISTRATION)).not.toThrow();
			expect(() => compile()(validIssue, null, MANAGER)).not.toThrow();
			expect(() => compile()(validIssue, null, ADMIN)).not.toThrow();
		});

		it('rejects warehouse_staff from creating distribution_issue', () => {
			expectForbidden(
				() => compile()(validIssue, null, WAREHOUSE),
				/Only registration staff, shelter manager, or system admin can write distribution issues/
			);
		});

		it('rejects updating an existing distribution_issue (append-only)', () => {
			expectForbidden(
				() => compile()({ ...validIssue, qty: '2' }, validIssue, REGISTRATION),
				/Cannot update append-only distribution_issue/
			);
		});

		it('rejects deleting an existing distribution_issue (append-only)', () => {
			expectForbidden(
				() => compile()({ ...validIssue, _deleted: true }, validIssue, REGISTRATION),
				/Cannot delete append-only distribution_issue/
			);
		});

		it('rejects type-changing update of distribution_issue', () => {
			expectForbidden(
				() => compile()({ ...validIssue, type: 'audit' }, validIssue, REGISTRATION),
				/Cannot update append-only distribution_issue/
			);
		});

		it('rejects distribution_issue with invalid positive qty', () => {
			expectForbidden(
				() => compile()({ ...validIssue, qty: '0' }, null, REGISTRATION),
				/positive qty decimal string/
			);
			expectForbidden(
				() => compile()({ ...validIssue, qty: '-1' }, null, REGISTRATION),
				/positive qty decimal string/
			);
		});

		it('rejects distribution_issue with invalid batch_id or evacuee_id prefix', () => {
			expectForbidden(
				() => compile()({ ...validIssue, batch_id: 'invalid:123' }, null, REGISTRATION),
				/valid batch_id/
			);
			expectForbidden(
				() => compile()({ ...validIssue, evacuee_id: 'invalid:123' }, null, REGISTRATION),
				/valid evacuee_id/
			);
		});

		it('rejects distribution_issue with invalid eligibility snapshot', () => {
			expectForbidden(
				() =>
					compile()(
						{
							...validIssue,
							eligibility_snapshot: {
								eligible: false,
								distribution_type: 'one_time',
								decision: 'repeat_rejected'
							}
						},
						null,
						REGISTRATION
					),
				/eligibility_snapshot is structurally invalid/
			);
		});

		it('allows valid repeat override snapshot matching repeat_override_reason', () => {
			const overrideIssue = {
				...validIssue,
				repeat_override_reason: 'lost',
				eligibility_snapshot: {
					eligible: true,
					distribution_type: 'one_time',
					decision: 'repeat_override',
					repeat_override_reason: 'lost',
					had_previous_receipt: true,
					previous_receipt_count: 1
				}
			};
			expect(() => compile()(overrideIssue, null, REGISTRATION)).not.toThrow();

			const mismatched = {
				...overrideIssue,
				repeat_override_reason: 'damaged'
			};
			expectForbidden(
				() => compile()(mismatched, null, REGISTRATION),
				/repeat_override_reason must match/
			);
		});

		it('manages distribution_issue_idempotency and enforces immutability', () => {
			expect(() => compile()(validIdempotency, null, REGISTRATION)).not.toThrow();
			expectForbidden(
				() => compile()(validIdempotency, null, WAREHOUSE),
				/Only registration staff, shelter manager, or system admin/
			);
			expectForbidden(
				() => compile()({ ...validIdempotency, qty: '2' }, validIdempotency, REGISTRATION),
				/Cannot update append-only distribution_issue_idempotency documents/
			);
			expectForbidden(
				() =>
					compile()({ ...validIdempotency, item_id: 'item:other' }, validIdempotency, REGISTRATION),
				/Cannot update append-only distribution_issue_idempotency documents/
			);
		});

		it('manages distribution_issue_capacity and enforces immutability', () => {
			expect(() => compile()(validCapacity, null, REGISTRATION)).not.toThrow();
			expectForbidden(
				() => compile()(validCapacity, null, WAREHOUSE),
				/Only registration staff, shelter manager, or system admin/
			);
			const mutated = {
				...validCapacity,
				item_id: 'item:other',
				pending_claims: [
					{
						...validCapacity.pending_claims[0],
						item_id: 'item:other'
					}
				]
			};
			expectForbidden(
				() => compile()(mutated, validCapacity, REGISTRATION),
				/Cannot change item_id on capacity record/
			);
		});

		it('manages distribution_one_time_guard and enforces immutability', () => {
			expect(() => compile()(validGuard, null, REGISTRATION)).not.toThrow();
			expectForbidden(
				() => compile()(validGuard, null, WAREHOUSE),
				/Only registration staff, shelter manager, or system admin/
			);
			const mutated = {
				...validGuard,
				evacuee_id: 'evacuee:other',
				pending_claims: [
					{
						...validGuard.pending_claims[0],
						evacuee_id: 'evacuee:other'
					}
				]
			};
			expectForbidden(
				() => compile()(mutated, validGuard, REGISTRATION),
				/Cannot change evacuee_id on one-time guard/
			);
		});
	});
});
