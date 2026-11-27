/**
 * The partner plane, copied from the binding spec: docs/data/api-contract.md §5.3 and ADR 0002
 * (EXT-001…012, scopes from `tent_model.third_party_client`). When §5.3 changes, change this
 * file in the same PR.
 */
import type { PartnerScope } from '../../lib/partner.ts';

export interface PartnerCtx {
	/** A seeded shelter on the public plane. */
	code: string;
	bookingId: string;
	/** A fictitious national ID (see `fictitiousCid`). */
	cid: string;
}

export interface PartnerEndpoint {
	ext: string;
	method: 'GET' | 'POST';
	path: (ctx: PartnerCtx) => string;
	scope: PartnerScope;
	query?: (ctx: PartnerCtx) => Record<string, string>;
	body?: (ctx: PartnerCtx) => unknown;
	/**
	 * Answer of a token that holds the scope, for this request with a CID nobody is registered
	 * under and a booking id that does not exist: the gate is open, the lookup finds nothing.
	 */
	passed: { status: number; code?: string };
}

export const PURPOSE = { purpose: 'permtest external api' };

export const PARTNER_ENDPOINTS: readonly PartnerEndpoint[] = [
	{
		ext: 'EXT-002',
		method: 'GET',
		path: () => '/external/locations',
		scope: 'location-read',
		passed: { status: 200 }
	},
	{
		ext: 'EXT-003',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}`,
		scope: 'location-read',
		passed: { status: 200 }
	},
	{
		ext: 'EXT-004',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/stock`,
		scope: 'location-stock-read',
		passed: { status: 200 }
	},
	{
		ext: 'EXT-005',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/occupancy`,
		scope: 'occupancy-read',
		passed: { status: 200 }
	},
	{
		ext: 'EXT-006',
		method: 'GET',
		path: () => '/external/summary',
		scope: 'location-read',
		passed: { status: 200 }
	},
	{
		ext: 'EXT-007',
		method: 'GET',
		path: (c) => `/external/locations/${c.code}/occupants`,
		scope: 'occupancy-pii-read',
		query: () => PURPOSE,
		passed: { status: 200 }
	},
	{
		ext: 'EXT-009',
		method: 'POST',
		path: (c) => `/external/bookings/${c.bookingId}/cancel`,
		scope: 'booking-write',
		passed: { status: 404, code: 'booking_not_found' }
	},
	{
		ext: 'EXT-010',
		method: 'GET',
		path: (c) => `/external/bookings/${c.bookingId}`,
		scope: 'booking-write',
		passed: { status: 404, code: 'booking_not_found' }
	},
	{
		ext: 'EXT-011',
		method: 'GET',
		path: () => '/external/persons/shelter-residency',
		scope: 'residency-read',
		query: (c) => ({ ...PURPOSE, cid: c.cid }),
		passed: { status: 404, code: 'residency_not_found' }
	},
	{
		ext: 'EXT-012',
		method: 'POST',
		path: () => '/external/persons/search',
		scope: 'occupant-search',
		query: () => PURPOSE,
		body: (c) => ({ search: c.cid }),
		passed: { status: 200 }
	}
];

/**
 * EXT-008 is left out of the table on purpose: a gate that failed open would create a real
 * booking. partner-bookings.test.ts covers it with its own ledger.
 */
export const BOOKING_CREATE = {
	ext: 'EXT-008',
	path: '/external/bookings',
	scope: 'booking-write' as PartnerScope
};
