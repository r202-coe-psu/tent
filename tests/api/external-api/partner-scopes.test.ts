/**
 * Partner scope matrix: each of the nine scopes opens exactly its own endpoints. A token
 * without the scope gets 403 `insufficient_scope` there and still works everywhere else; a
 * token holding only that scope works there and nowhere else. `booking-bypass` and `pii-full`
 * are modifiers that open nothing on their own. docs/data/api-contract.md §5.3, ADR 0002 §6.
 */
import { expect, test } from '@playwright/test';
import { fastapiTarget, shelterCodes } from '../../lib/env.ts';
import { fastapiIsUp, type ApiResult } from '../../lib/fastapi.ts';
import {
	PARTNER_SCOPES,
	PartnerClients,
	callExt,
	extCode,
	fictitiousCid,
	type PartnerScope
} from '../../lib/partner.ts';
import {
	BOOKING_CREATE,
	PARTNER_ENDPOINTS,
	type PartnerCtx,
	type PartnerEndpoint
} from './partner-endpoints.ts';

const RUN = Date.now().toString(36);
const clients = new PartnerClients(RUN);
/** Scopes that gate no route of their own (ADR 0002, #751, CR-257). */
const MODIFIERS: readonly PartnerScope[] = ['booking-bypass', 'pii-full'];

function call(token: string, e: PartnerEndpoint): Promise<ApiResult> {
	const c: PartnerCtx = {
		code: shelterCodes().a,
		bookingId: 'bk_permtest_none',
		cid: fictitiousCid()
	};
	return callExt(token, e.path(c), { method: e.method, query: e.query?.(c), body: e.body?.(c) });
}

function expectPassed(res: ApiResult, e: PartnerEndpoint, label: string): void {
	expect(res.status, `${e.ext} ${label} (code ${extCode(res)})`).toBe(e.passed.status);
	if (e.passed.code) expect(extCode(res), `${e.ext} ${label}`).toBe(e.passed.code);
}

function expectDenied(res: ApiResult, ext: string, label: string): void {
	expect(res.status, `${ext} ${label} (code ${extCode(res)})`).toBe(403);
	expect(extCode(res), `${ext} ${label}`).toBe('insufficient_scope');
}

/** EXT-008 aimed at a location that does not exist: even a gate that failed open books nobody. */
function createBooking(token: string): Promise<ApiResult> {
	return callExt(token, BOOKING_CREATE.path, {
		method: 'POST',
		body: {
			location_code: 'PERMTEST-NONE',
			persons: [{ cid: fictitiousCid(), first_name: 'PERMTEST', last_name: 'Scope' }]
		}
	});
}

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
});

test.afterAll(async () => {
	await clients.cleanup();
});

test('every scope is either a gate on some endpoint or a known modifier', () => {
	for (const scope of PARTNER_SCOPES) {
		const gates =
			PARTNER_ENDPOINTS.some((e) => e.scope === scope) || BOOKING_CREATE.scope === scope;
		expect(gates || MODIFIERS.includes(scope), `${scope} is covered by the matrix`).toBe(true);
	}
});

for (const scope of PARTNER_SCOPES) {
	test(`without ${scope}: its endpoints are 403, the rest still answer`, async () => {
		const token = await clients.tokenWith(
			`no-${scope}`,
			PARTNER_SCOPES.filter((s) => s !== scope)
		);
		for (const e of PARTNER_ENDPOINTS) {
			const res = await call(token, e);
			if (e.scope === scope) expectDenied(res, e.ext, `without ${scope}`);
			else expectPassed(res, e, `without ${scope}`);
		}
		if (scope === BOOKING_CREATE.scope) {
			expectDenied(await createBooking(token), BOOKING_CREATE.ext, `without ${scope}`);
		}
	});

	test(`only ${scope}: it opens its endpoints and nothing else`, async () => {
		const token = await clients.tokenWith(`only-${scope}`, [scope]);
		for (const e of PARTNER_ENDPOINTS) {
			const res = await call(token, e);
			if (e.scope === scope) expectPassed(res, e, `with only ${scope}`);
			else expectDenied(res, e.ext, `with only ${scope}`);
		}
		if (scope !== BOOKING_CREATE.scope) {
			expectDenied(await createBooking(token), BOOKING_CREATE.ext, `with only ${scope}`);
		}
	});
}

test('EXT-006 hides the cross-location occupancy total without occupancy-read', async () => {
	const withOcc = await clients.tokenWith('summary-occ', ['location-read', 'occupancy-read']);
	const without = await clients.tokenWith('summary-noocc', ['location-read']);
	const a = await callExt(withOcc, '/external/summary');
	const b = await callExt(without, '/external/summary');
	expect(a.status).toBe(200);
	expect(b.status).toBe(200);
	expect(typeof a.body.result.occupancy_total).toBe('number');
	expect(b.body.result.occupancy_total).toBeNull();
});

test('purpose is checked before the scope on EXT-007, EXT-011 and EXT-012', async () => {
	// A token with no matching scope still gets 400 for a missing purpose: the attempt is logged
	// with what was asked for (ADR 0002 §6).
	const token = await clients.tokenWith('purpose', ['location-read']);
	const code = shelterCodes().a;
	const cases: [string, Promise<ApiResult>][] = [
		['EXT-007', callExt(token, `/external/locations/${code}/occupants`)],
		[
			'EXT-011',
			callExt(token, '/external/persons/shelter-residency', { query: { cid: fictitiousCid() } })
		],
		[
			'EXT-012',
			callExt(token, '/external/persons/search', {
				method: 'POST',
				body: { search: fictitiousCid() }
			})
		],
		[
			'EXT-007 blank purpose',
			callExt(token, `/external/locations/${code}/occupants`, { query: { purpose: '   ' } })
		]
	];
	for (const [label, pending] of cases) {
		const res = await pending;
		expect(res.status, `${label} (code ${extCode(res)})`).toBe(400);
		expect(extCode(res), label).toBe('missing_purpose');
	}
});
