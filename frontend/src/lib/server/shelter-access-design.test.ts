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

		it.each(['meal_session', 'kitchen_counter'])('includes %s in the allowed whitelist', (type) => {
			expect(buildValidateDocUpdate('SH001')).toContain(`'${type}'`);
		});

		it.each(['meal_service', 'gas_ledger'])(
			'rejects updating an existing %s (append-only)',
			(type) => {
				const doc = { ...envelope, schema_v: 1, _id: `${type}:01J`, type };
				expectForbidden(
					() => compile()({ ...doc, touched: true }, doc, KITCHEN),
					new RegExp(`Cannot update append-only ${type}`)
				);
			}
		);

		it('allows updating a pending kitchen_requisition', () => {
			const doc = {
				...envelope,
				schema_v: 3,
				_id: 'kitchen_requisition:01J',
				type: 'kitchen_requisition',
				status: 'pending'
			};
			expect(() => compile()({ ...doc, status: 'approved' }, doc, KITCHEN)).not.toThrow();
		});

		it('rejects updating an approved kitchen_requisition', () => {
			const doc = {
				...envelope,
				schema_v: 3,
				_id: 'kitchen_requisition:01J',
				type: 'kitchen_requisition',
				status: 'approved'
			};
			expectForbidden(
				() => compile()({ ...doc, touched: true }, doc, KITCHEN),
				/Cannot update finalized kitchen_requisition/
			);
		});

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
	});
});
