/**
 * Federated staff QR lookup: Couch shelter SoR first, then Mongo unassigned queue.
 * Live store calls only — do not route scan through `fetchQuery` (global staleTime
 * would serve a prior miss). Cache keys below mirror `peopleKeys` /
 * `unassignedRegistrationKeys` without importing `queries.ts` (circular init).
 */
import type { QueryClient } from '@tanstack/svelte-query';
import { getShelterCode } from '$lib/db/shelter';
import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration/data/unassigned-registration.remote';
import type { UnassignedRegistrationSearchHit } from '$lib/features/unassigned-registration/domain/search';
import { peopleRepository } from '../data/people.remote';
import type { Evacuee } from '../domain/people';
import type { EvacueeQrPrintRef, PersonQrVerdict } from '$lib/utils/evacuee-qr';
import { readEvacueeQrPrints } from '../data/evacuee-qr.remote';
import { checkPersonQr, staffPersonQrRejectionMessage } from './evacuee-qr-check';
import {
	extractScanPersonQr,
	extractScanLookupToken,
	mongoUnassignedSearchQueries,
	pickUnassignedSearchHit,
	toCouchEvacueeId
} from '../domain/scan-lookup';

export type FederatedScanCouchHit = {
	source: 'couch';
	evacuee: Evacuee;
};

export type FederatedScanUnassignedHit = {
	source: 'unassigned';
	hit: UnassignedRegistrationSearchHit;
};

/**
 * Expired / invalid Person QR (CR-233 FR-EQR-34): carries only the message, no evacuee. Callers
 * toast `message` and must not open a profile or record any action.
 */
export type FederatedScanRejectedHit = {
	source: 'qr_rejected';
	verdict: Exclude<PersonQrVerdict, { status: 'valid' }>;
	message: string;
};

export type FederatedScanHit =
	FederatedScanCouchHit | FederatedScanUnassignedHit | FederatedScanRejectedHit;

export type FederatedScanLookupDeps = {
	getEvacuee: (id: string) => Promise<Evacuee | null>;
	searchEvacuees: (q: string) => Promise<Evacuee[]>;
	searchUnassigned: (q: string) => Promise<{ results: UnassignedRegistrationSearchHit[] }>;
	/** `evacuee_qr:{ULID}` prints (missing doc = []). Errors propagate: never treated as valid. */
	listQrPrints: (evacueeId: string) => Promise<readonly EvacueeQrPrintRef[]>;
};

/** Pure orchestration — unit-tested with injected deps. */
export async function lookupFederatedByScanCodeWithDeps(
	raw: string,
	deps: FederatedScanLookupDeps
): Promise<FederatedScanHit | null> {
	const token = extractScanLookupToken(raw);
	if (!token) return null;

	// Person QR (`evacuee:{ULID}[@hash6]`): apply the scan rule before anything is opened. A bare
	// ULID registration ticket is not a Person QR and skips this (FR-EQR-31).
	const personQr = extractScanPersonQr(raw);
	if (personQr) {
		const verdict = await checkPersonQr(personQr, deps.listQrPrints);
		if (verdict.status !== 'valid') {
			return { source: 'qr_rejected', verdict, message: staffPersonQrRejectionMessage(verdict) };
		}
	}

	const couchId = personQr?.evacuee_id ?? toCouchEvacueeId(token);
	try {
		const byId = await deps.getEvacuee(couchId);
		if (byId) return { source: 'couch', evacuee: byId };
	} catch {
		// Fall through to search.
	}

	const couchMatches = await deps.searchEvacuees(token);
	if (couchMatches[0]) return { source: 'couch', evacuee: couchMatches[0] };

	for (const q of mongoUnassignedSearchQueries(token)) {
		try {
			const res = await deps.searchUnassigned(q);
			const hit = pickUnassignedSearchHit(res.results, q);
			if (hit) return { source: 'unassigned', hit };
		} catch {
			// Pool offline — try next candidate / miss.
		}
	}

	return null;
}

/**
 * One-shot federated scan lookup (Couch → Mongo unassigned).
 * Always hits the live stores (never serves a prior TanStack miss/hit from staleTime).
 * Callers open claim/intake UI on `source: 'unassigned'`, or toast when null.
 */
export async function lookupFederatedByScanCode(
	queryClient: QueryClient,
	code: string
): Promise<FederatedScanHit | null> {
	const shelter = getShelterCode();
	const result = await lookupFederatedByScanCodeWithDeps(code, {
		getEvacuee: (id) => peopleRepository().getEvacuee(id),
		searchEvacuees: (q) => peopleRepository().searchEvacuees(q),
		searchUnassigned: (q) => unassignedRegistrationRemote.searchOpen(q),
		listQrPrints: (id) => readEvacueeQrPrints(id)
	});

	// Warm / refresh related cache so Station 1 table + profile queries catch up
	// without requiring a full page reload after a successful scan.
	if (result?.source === 'couch') {
		queryClient.setQueryData(
			['people', 'evacuee', shelter, result.evacuee._id] as const,
			result.evacuee
		);
		void queryClient.invalidateQueries({
			queryKey: ['people', 'evacuees', shelter] as const
		});
	} else if (result?.source === 'unassigned') {
		void queryClient.invalidateQueries({
			queryKey: ['unassigned-registration', 'search'] as const
		});
	}

	return result;
}
