/**
 * Server-only helpers for SA system overview aggregates + pre-registration PII.
 * Uses Couch fan-in across shelter DBs + FastAPI for Mongo unassigned queue.
 *
 * Do not import feature barrels here — `$lib/features/people` re-exports UI that
 * pulls CJS `qrcode` into the Vite SSR graph (`module is not defined`).
 * Match other back-office routes: domain / `shelters/server` deep paths only.
 */
/* eslint-disable no-restricted-imports -- server-safe domain imports; barrels pull client UI */
import { adminRaw, requireShelterScopeOrSA, ServiceError } from '$lib/server/couch-admin';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import { fastapiBaseUrl, unwrapFastapiError } from '$lib/server/fastapi';
import {
	isExternalShelter,
	resolveOperationStatus,
	type ShelterMaster
} from '$lib/features/shelters/server';
import { maskNationalId } from '$lib/features/people/domain/people';
import {
	ageBandForBirthYear,
	emptyAgeGroups,
	forecastFromCounts,
	overviewDemographicsPayloadSchema,
	overviewMovementsPayloadSchema,
	overviewOriginPayloadSchema,
	overviewSitesPayloadSchema,
	overviewSummarySchema,
	parseOverviewFilters,
	pct,
	preRegistrationProfileSchema,
	preRegistrationsListPayloadSchema,
	presentFromCounts,
	type OverviewFilters,
	type OverviewSiteRow,
	type OriginBucket,
	type PreRegistrationListItem,
	type PreRegistrationProfile,
	type HouseholdOption,
	resolveMovementDateRange
} from '$lib/features/system-overview/domain';

const noStore = { 'Cache-Control': 'no-store' };

export async function requireOverviewSA(cookie: string | null) {
	const caller = await requireShelterScopeOrSA(cookie);
	if (!caller.isSA) {
		throw new ServiceError('FORBIDDEN', 'System overview requires system_admin');
	}
	return caller;
}

function matchesShelterGeo(master: ShelterMaster, filters: OverviewFilters): boolean {
	if (filters.shelter_province && (master.province ?? '') !== filters.shelter_province) {
		return false;
	}
	if (filters.shelter_district && (master.district ?? '') !== filters.shelter_district) {
		return false;
	}
	if (filters.shelter_subdistrict && (master.subdistrict ?? '') !== filters.shelter_subdistrict) {
		return false;
	}
	if (filters.site_kind && master.site_kind !== filters.site_kind) return false;
	if (filters.external === 'only' && !isExternalShelter(master)) return false;
	// Picking a regular kind excludes external shelters (they have their own filter option/card).
	if (filters.site_kind && isExternalShelter(master)) return false;
	// A shelter with no status is shown (and filtered) as 'unknown', same as the site rows.
	const op = resolveOperationStatus(master) ?? 'unknown';
	if (filters.operation_status && op !== filters.operation_status) return false;
	if (filters.shelter_code && master.code !== filters.shelter_code) return false;
	return true;
}

type StatusCounts = Record<string, number>;

/**
 * Short-lived per-process memo (#1502). The overview page fires summary / sites / origin /
 * demographics / movements in parallel and each used to re-read the same per-shelter views.
 * Sharing the in-flight promise collapses those into one request per shelter; the TTL is short
 * enough that dashboard numbers never lag noticeably.
 */
const VIEW_CACHE_TTL_MS = 5_000;
const viewCache = new Map<string, { at: number; value: Promise<unknown> }>();

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = viewCache.get(key);
	if (hit && now - hit.at < VIEW_CACHE_TTL_MS) return hit.value as Promise<T>;
	const value = load();
	viewCache.set(key, { at: now, value });
	value.catch(() => {
		if (viewCache.get(key)?.value === value) viewCache.delete(key);
	});
	if (viewCache.size > 2_000) {
		for (const [k, v] of viewCache) {
			if (now - v.at >= VIEW_CACHE_TTL_MS) viewCache.delete(k);
		}
	}
	return value;
}

/** Test hook: drop the memoised per-shelter view reads. */
export function clearOverviewViewCache(): void {
	viewCache.clear();
}

// Loaders THROW on a failed read so memo() drops the entry; callers degrade to "no data"
// without a transient CouchDB error being cached for the whole TTL.
function occupancyCounts(code: string): Promise<StatusCounts> {
	return memo(`occ:${code}`, () => fetchOccupancyCounts(code)).catch(() => ({}));
}

async function fetchOccupancyCounts(code: string): Promise<StatusCounts> {
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
	const counts: StatusCounts = {};
	if (res.status >= 400) throw new Error(`occupancy view ${res.status}`);
	const rows = (res.data as { rows?: { key: string; value: number }[] })?.rows ?? [];
	for (const row of rows) counts[row.key] = (counts[row.key] ?? 0) + row.value;
	return counts;
}

function movementTotals(
	code: string,
	from: string,
	to: string
): Promise<{ checkin: number; checkout: number }> {
	return memo(`mov:${code}:${from}:${to}`, () => fetchMovementTotals(code, from, to)).catch(() => ({
		checkin: 0,
		checkout: 0
	}));
}

async function fetchMovementTotals(
	code: string,
	from: string,
	to: string
): Promise<{ checkin: number; checkout: number }> {
	const db = `shelter_${code.toLowerCase()}`;
	const SENTINEL = '\ufff0';
	const viewPath =
		`/${db}/_design/app/_view/registrations_by_date_status?group=true` +
		`&startkey=${encodeURIComponent(JSON.stringify([from, '']))}` +
		`&endkey=${encodeURIComponent(JSON.stringify([to + SENTINEL, SENTINEL]))}`;
	const res = await adminRaw(viewPath, 'GET');
	let checkin = 0;
	let checkout = 0;
	if (res.status >= 400) throw new Error(`movements view ${res.status}`);
	const rows = (res.data as { rows?: { key: [string, string]; value: number }[] })?.rows ?? [];
	for (const row of rows) {
		const series = row.key?.[1];
		if (series === 'checkin') checkin += row.value;
		else if (series === 'checkout') checkout += row.value;
	}
	return { checkin, checkout };
}

async function demographicsForShelter(code: string): Promise<{
	age_groups: ReturnType<typeof emptyAgeGroups>;
	countries: Record<string, number>;
	age_by_country: Record<string, ReturnType<typeof emptyAgeGroups>>;
}> {
	const db = `shelter_${code.toLowerCase()}`;
	const ageGroups = emptyAgeGroups();
	const countries: Record<string, number> = {};
	const ageByCountry: Record<string, ReturnType<typeof emptyAgeGroups>> = {};
	const currentYear = new Date().getFullYear();

	// One reduced view pass cross-tabs country x birth_year (#1502) — no _find over every evacuee.
	const crossRes = await adminRaw(
		`/${db}/_design/app/_view/demographics_by_country_age?group=true`,
		'GET'
	);
	if (crossRes.status < 400) {
		const rows =
			(crossRes.data as { rows?: { key: [string, number | null]; value: number }[] })?.rows ?? [];
		for (const row of rows) {
			const country = row.key?.[0] || 'UNKNOWN';
			const birthYear = row.key?.[1];
			const band = ageBandForBirthYear(
				typeof birthYear === 'number' ? birthYear : null,
				currentYear
			);
			ageGroups[band] += row.value;
			countries[country] = (countries[country] ?? 0) + row.value;
			const perCountry = ageByCountry[country] ?? emptyAgeGroups();
			perCountry[band] += row.value;
			ageByCountry[country] = perCountry;
		}
		return { age_groups: ageGroups, countries, age_by_country: ageByCountry };
	}

	// Stale shelter DB (view manifest < v9): independent views, no per-country age cross-tab.
	const [ageRes, countryRes] = await Promise.all([
		adminRaw(`/${db}/_design/app/_view/demographics_by_age?group=true`, 'GET'),
		adminRaw(`/${db}/_design/app/_view/demographics_by_country?group=true`, 'GET')
	]);
	if (ageRes.status < 400) {
		const rows = (ageRes.data as { rows?: { key: number | null; value: number }[] })?.rows ?? [];
		for (const row of rows) {
			const band = ageBandForBirthYear(typeof row.key === 'number' ? row.key : null, currentYear);
			ageGroups[band] += row.value;
		}
	}
	if (countryRes.status < 400) {
		const rows = (countryRes.data as { rows?: { key: string; value: number }[] })?.rows ?? [];
		for (const row of rows) {
			if (typeof row.key !== 'string') continue;
			countries[row.key] = (countries[row.key] ?? 0) + row.value;
		}
	}
	return { age_groups: ageGroups, countries, age_by_country: ageByCountry };
}

type SiteMetric = {
	master: ShelterMaster;
	counts: StatusCounts;
	present: number;
	forecast: number;
	pre_registered: number;
	capacity: number;
	operation_status: string;
	row: OverviewSiteRow;
};

async function loadSiteMetrics(filters: OverviewFilters): Promise<SiteMetric[]> {
	// Registry may still hold pre-CR-067 masters (no site_kind). Migrate on read
	// like other back-office routes — raw docs fail overviewSitesPayloadSchema.
	const masters = (await listShelterMasters())
		.map(migrate)
		.filter((m) => matchesShelterGeo(m, filters));
	const settled = await Promise.all(
		masters.map(async (master) => {
			const counts = await occupancyCounts(master.code);
			const present = presentFromCounts(counts);
			const forecast = forecastFromCounts(counts);
			const pre_registered = (counts.pre_registered ?? 0) + (counts.kiosk_registered ?? 0);
			const capacity = master.capacity ?? 0;
			const operation_status = resolveOperationStatus(master) ?? 'unknown';
			const row: OverviewSiteRow = {
				shelter_code: master.code,
				name: master.name,
				site_kind: master.site_kind,
				operation_status,
				province: master.province ?? null,
				district: master.district ?? null,
				subdistrict: master.subdistrict ?? null,
				capacity,
				present,
				forecast,
				pre_registered,
				present_pct: pct(present, capacity),
				forecast_pct: pct(forecast, capacity),
				checkin: 0,
				checkout: 0,
				has_coords:
					typeof master.location?.lat === 'number' && typeof master.location?.lng === 'number',
				is_external: isExternalShelter(master),
				dashboard_href: `/back-office/evacuee-management?shelter=${encodeURIComponent(master.code)}`
			};
			return {
				master,
				counts,
				present,
				forecast,
				pre_registered,
				capacity,
				operation_status,
				row
			} satisfies SiteMetric;
		})
	);

	return settled.filter((site) => {
		if (filters.stay_bucket === 'present' && site.present <= 0) return false;
		if (filters.stay_bucket === 'forecast' && site.forecast <= 0) return false;
		if (filters.stay_bucket === 'pre_registered' && site.pre_registered <= 0) return false;
		if (filters.stay_bucket === 'checked_out' && (site.counts.checked_out ?? 0) <= 0) {
			return false;
		}
		return true;
	});
}

type FastapiFetch = typeof fetch;

async function fastapiJson<T>(
	fetchFn: FastapiFetch,
	cookie: string | null,
	path: string
): Promise<T | null> {
	const url = `${fastapiBaseUrl()}${path}`;
	let apiRes: Response;
	try {
		apiRes = await fetchFn(url, {
			headers: {
				Accept: 'application/json',
				...(cookie ? { Cookie: cookie } : {})
			}
		});
	} catch {
		return null;
	}
	const body = await apiRes.json().catch(() => ({}));
	if (!apiRes.ok) {
		unwrapFastapiError(body, 'ONLINE_REQUIRED');
		return null;
	}
	return body as T;
}

type UnassignedStats = { open_registrations: number; open_members: number };
type UnassignedList = {
	items: Array<{
		id: string;
		reserved_household_id: string;
		registered_via: string;
		status: string;
		created_at: string;
		household: {
			label?: string | null;
			province?: string | null;
			district?: string | null;
			subdistrict?: string | null;
			housing_type?: string | null;
			residence_landmark?: string | null;
			address_no?: string | null;
		};
		open_members: Array<{
			reserved_evacuee_id: string;
			first_name: string;
			last_name: string;
			country: string;
			birth_year?: number | null;
			age?: number | null;
			phone?: string | null;
			person_id?: { number?: string | null } | null;
			vulnerable_groups?: string[];
			special_needs?: string[];
			status?: string;
		}>;
		open_member_count: number;
	}>;
	total: number;
	open_member_count: number;
	limit: number;
	offset: number;
};

type UnassignedDetail = {
	id: string;
	reserved_household_id: string;
	registered_via: string;
	status: string;
	created_at: string;
	household: UnassignedList['items'][number]['household'];
	members: Array<{
		reserved_evacuee_id: string;
		status: string;
		first_name: string;
		last_name: string;
		country: string;
		birth_year?: number | null;
		age?: number | null;
		phone?: string | null;
		person_id?: { number?: string | null } | null;
		vulnerable_groups?: string[];
		special_needs?: string[];
	}>;
};

export async function buildOverviewSummary(
	filters: OverviewFilters,
	fetchFn: FastapiFetch,
	cookie: string | null
) {
	const [sites, stats] = await Promise.all([
		loadSiteMetrics(filters),
		fastapiJson<UnassignedStats>(fetchFn, cookie, '/staff/v1/unassigned-registrations/stats')
	]);
	const { from, to } = resolveMovementDateRange(filters);
	const movements = await Promise.all(sites.map((s) => movementTotals(s.master.code, from, to)));
	const checkouts = movements.reduce((sum, m) => sum + m.checkout, 0);

	// "In shelters" figures (present / forecast / capacity %) skip closed and cancelled shelters
	// and external ones (run in another system); site counts still cover every shelter.
	const counted = sites.filter(
		(s) =>
			s.operation_status !== 'closed' &&
			s.operation_status !== 'cancelled' &&
			!isExternalShelter(s.master)
	);
	const present_total = counted.reduce((s, x) => s + x.present, 0);
	const forecast_total = counted.reduce((s, x) => s + x.forecast, 0);
	const pre_registered_at_sites = sites.reduce((s, x) => s + x.pre_registered, 0);
	const capacity_total = counted.reduce((s, x) => s + x.capacity, 0);

	const sites_by_status: Record<string, number> = {};
	for (const s of sites) {
		sites_by_status[s.operation_status] = (sites_by_status[s.operation_status] ?? 0) + 1;
	}

	// Same site set as sites_total (every status). External shelters get their own count and
	// are left out of the per-kind map, so kinds + sites_external sum to sites_total.
	// migrate() already defaults a missing site_kind to evacuation_center (CR-067).
	const sites_by_site_kind: Record<string, number> = {};
	let sites_external = 0;
	for (const s of sites) {
		if (isExternalShelter(s.master)) {
			sites_external += 1;
			continue;
		}
		const kind = s.master.site_kind || 'evacuation_center';
		sites_by_site_kind[kind] = (sites_by_site_kind[kind] ?? 0) + 1;
	}

	return overviewSummarySchema.parse({
		unassigned_members: stats?.open_members ?? 0,
		unassigned_registrations: stats?.open_registrations ?? 0,
		pre_registered_at_sites,
		present_total,
		forecast_total,
		avg_present_pct: pct(present_total, capacity_total),
		avg_forecast_pct: pct(forecast_total, capacity_total),
		sites_by_status,
		sites_by_site_kind,
		sites_external,
		checkouts_in_window: checkouts,
		sites_closed: sites.filter((s) => s.operation_status === 'closed').length,
		sites_open_with_present: sites.filter(
			(s) => s.operation_status !== 'closed' && s.operation_status !== 'cancelled' && s.present > 0
		).length,
		sites_total: sites.length,
		movement_window: filters.movement_window
	});
}

/**
 * Shrinking totals (filter change, a record removed) must not strand the caller on an empty
 * page: snap to the last page and report the offset actually used.
 */
function clampOffset(total: number, offset: number, limit: number): number {
	return total > 0 && offset >= total ? Math.floor((total - 1) / limit) * limit : offset;
}

export async function buildOverviewSites(filters: OverviewFilters) {
	// Occupancy is one cheap reduced view per shelter and drives sort + total; the costlier
	// movements read runs only for the rows on the requested page (#1502).
	const sites = await loadSiteMetrics(filters);
	// shelter_code tie-break keeps page boundaries stable when forecast_pct ties (e.g. all -1).
	const sorted = [...sites].sort(
		(a, b) =>
			(b.row.forecast_pct ?? -1) - (a.row.forecast_pct ?? -1) ||
			(a.master.code < b.master.code ? -1 : a.master.code > b.master.code ? 1 : 0)
	);
	const offset = clampOffset(sorted.length, filters.offset, filters.limit);
	const pageSites = sorted.slice(offset, offset + filters.limit);
	const { from, to } = resolveMovementDateRange(filters);
	const rows = await Promise.all(
		pageSites.map(async (s) => {
			const movements = await movementTotals(s.master.code, from, to);
			return {
				...s.row,
				checkin: movements.checkin,
				checkout: movements.checkout
			} satisfies OverviewSiteRow;
		})
	);
	return overviewSitesPayloadSchema.parse({
		sites: rows,
		total: sorted.length,
		limit: filters.limit,
		offset
	});
}

export async function buildOverviewDemographics(filters: OverviewFilters) {
	const sites = await loadSiteMetrics(filters);
	const age_groups = emptyAgeGroups();
	const countries: Record<string, number> = {};
	const age_by_country: Record<string, ReturnType<typeof emptyAgeGroups>> = {};
	const parts = await Promise.all(sites.map((s) => demographicsForShelter(s.master.code)));
	for (const part of parts) {
		for (const key of Object.keys(age_groups) as (keyof typeof age_groups)[]) {
			age_groups[key] += part.age_groups[key];
		}
		for (const [country, n] of Object.entries(part.countries)) {
			countries[country] = (countries[country] ?? 0) + n;
		}
		for (const [country, groups] of Object.entries(part.age_by_country)) {
			const merged = age_by_country[country] ?? emptyAgeGroups();
			for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
				merged[key] += groups[key];
			}
			age_by_country[country] = merged;
		}
	}

	let displayAges = age_groups;
	if (filters.country) {
		const want = filters.country.toUpperCase();
		const matchedKey =
			Object.keys(age_by_country).find((k) => k === want || k === filters.country) ?? want;
		displayAges = age_by_country[matchedKey] ? { ...age_by_country[matchedKey] } : emptyAgeGroups();
		for (const key of Object.keys(countries)) {
			if (key !== want && key !== filters.country) {
				delete countries[key];
			}
		}
	}
	if (filters.age_band) {
		for (const key of Object.keys(displayAges) as (keyof typeof displayAges)[]) {
			if (key !== filters.age_band) displayAges[key] = 0;
		}
	}
	return overviewDemographicsPayloadSchema.parse({
		age_groups: displayAges,
		countries,
		age_by_country
	});
}

export async function buildOverviewMovements(filters: OverviewFilters) {
	const sites = await loadSiteMetrics(filters);
	const { from, to } = resolveMovementDateRange(filters);
	const parts = await Promise.all(sites.map((s) => movementTotals(s.master.code, from, to)));
	const usedExplicitRange = Boolean(filters.movement_from || filters.movement_to);
	return overviewMovementsPayloadSchema.parse({
		...(usedExplicitRange ? {} : { window: filters.movement_window }),
		from,
		to,
		checkin: parts.reduce((s, p) => s + p.checkin, 0),
		checkout: parts.reduce((s, p) => s + p.checkout, 0)
	});
}

type EvacueeDoc = {
	_id: string;
	type?: string;
	first_name?: string;
	last_name?: string;
	country?: string;
	birth_year?: number | null;
	age?: number | null;
	phone?: string | null;
	person_id?: { number?: string | null } | null;
	vulnerable_groups?: string[];
	special_needs?: string[];
	household_id?: string;
	current_stay?: { status?: string; since?: string };
	created_at?: string;
	registered_via?: string;
};

type HouseholdDoc = {
	_id: string;
	type?: string;
	label?: string | null;
	status?: string | null;
	shelter_code?: string | null;
	province?: string | null;
	district?: string | null;
	subdistrict?: string | null;
	housing_type?: string | null;
	residence_landmark?: string | null;
	address_no?: string | null;
};

async function findPreRegisteredEvacuees(code: string): Promise<EvacueeDoc[]> {
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_find`, 'POST', {
		selector: {
			type: 'evacuee',
			$or: [
				{ 'current_stay.status': 'pre_registered' },
				{ registered_via: { $in: ['web', 'kiosk', 'backoffice', 'import'] } }
			]
		},
		limit: 10_000
	});
	if (res.status >= 400) return [];
	return ((res.data as { docs?: EvacueeDoc[] })?.docs ?? []).filter((d) => d.type === 'evacuee');
}

async function getHouseholdsMap(code: string): Promise<Map<string, HouseholdDoc>> {
	const map = new Map<string, HouseholdDoc>();
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_find`, 'POST', {
		selector: { type: 'household' },
		limit: 10_000
	});
	if (res.status < 400 && res.data) {
		const docs = ((res.data as { docs?: HouseholdDoc[] }).docs ?? []).filter(
			(d) => d.type === 'household' || d._id?.startsWith('household:')
		);
		for (const d of docs) {
			map.set(d._id, d);
		}
	}
	return map;
}

/** Fetch households by id in one `_all_docs` call (#1502) instead of one GET per evacuee. */
async function getHouseholdsByIds(
	code: string,
	householdIds: Iterable<string>
): Promise<Map<string, HouseholdDoc>> {
	const map = new Map<string, HouseholdDoc>();
	const keys = [...new Set([...householdIds].filter(Boolean))];
	if (keys.length === 0) return map;
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_all_docs?include_docs=true`, 'POST', { keys });
	if (res.status >= 400) return map;
	const rows = (res.data as { rows?: { doc?: HouseholdDoc | null }[] })?.rows ?? [];
	for (const row of rows) {
		if (row.doc && row.doc._id) map.set(row.doc._id, row.doc);
	}
	return map;
}

function displayName(first?: string, last?: string): string {
	return [first, last].filter(Boolean).join(' ').trim() || '—';
}

function matchesResidence(
	province: string | null | undefined,
	district: string | null | undefined,
	subdistrict: string | null | undefined,
	filters: OverviewFilters
): boolean {
	if (filters.residence_province && (province ?? '') !== filters.residence_province) return false;
	if (filters.residence_district && (district ?? '') !== filters.residence_district) return false;
	if (filters.residence_subdistrict && (subdistrict ?? '') !== filters.residence_subdistrict) {
		return false;
	}
	return true;
}

export async function buildOverviewOrigin(
	filters: OverviewFilters,
	fetchFn: FastapiFetch,
	cookie: string | null
) {
	const bucketMap = new Map<string, OriginBucket>();
	const bump = (province: string, district: string | null, subdistrict: string | null) => {
		const key = `${province}|${district ?? ''}|${subdistrict ?? ''}`;
		const existing = bucketMap.get(key);
		if (existing) existing.count += 1;
		else
			bucketMap.set(key, {
				province: province || 'ไม่ระบุ',
				district,
				subdistrict,
				count: 1
			});
	};

	if (filters.source !== 'bound') {
		const qs = new URLSearchParams({ limit: '200', offset: '0' });
		if (filters.residence_province) qs.set('province', filters.residence_province);
		if (filters.residence_district) qs.set('district', filters.residence_district);
		if (filters.residence_subdistrict) qs.set('subdistrict', filters.residence_subdistrict);
		if (filters.q) qs.set('q', filters.q);
		const list = await fastapiJson<UnassignedList>(
			fetchFn,
			cookie,
			`/staff/v1/unassigned-registrations?${qs}`
		);
		for (const item of list?.items ?? []) {
			for (let i = 0; i < item.open_member_count; i++) {
				bump(
					item.household.province ?? '',
					item.household.district ?? null,
					item.household.subdistrict ?? null
				);
			}
		}
	}

	if (filters.source !== 'unassigned') {
		const sites = await loadSiteMetrics(filters);
		for (const site of sites) {
			const evacuees = await findPreRegisteredEvacuees(site.master.code);
			const households = await getHouseholdsByIds(
				site.master.code,
				evacuees.map((ev) => ev.household_id ?? '')
			);
			for (const ev of evacuees) {
				const hh = ev.household_id ? (households.get(ev.household_id) ?? null) : null;
				if (!matchesResidence(hh?.province, hh?.district, hh?.subdistrict, filters)) {
					continue;
				}
				bump(hh?.province ?? '', hh?.district ?? null, hh?.subdistrict ?? null);
			}
		}
	}

	const buckets = [...bucketMap.values()].sort((a, b) => b.count - a.count);
	return overviewOriginPayloadSchema.parse({ buckets });
}

function matchesStayBucket(stayStatus: string, stayBucket?: string): boolean {
	if (!stayBucket || stayBucket === 'all') return true;
	if (stayBucket === 'present') {
		return (
			stayStatus === 'active' || stayStatus === 'room_confirmed' || stayStatus === 'temporary_leave'
		);
	}
	if (stayBucket === 'forecast') {
		return [
			'pre_registered',
			'kiosk_registered',
			'arriving',
			'active',
			'room_confirmed',
			'temporary_leave'
		].includes(stayStatus);
	}
	if (stayBucket === 'pre_registered') {
		return (
			stayStatus === 'pre_registered' ||
			stayStatus === 'kiosk_registered' ||
			stayStatus === 'unassigned'
		);
	}
	if (stayBucket === 'checked_out') {
		return stayStatus === 'checked_out';
	}
	return true;
}

function boundItem(
	master: ShelterMaster,
	ev: EvacueeDoc,
	hh: HouseholdDoc | null,
	stayStatus: string,
	name: string
): PreRegistrationListItem {
	let queueStatus = `${stayStatus === 'kiosk_registered' ? 'kiosk_registered' : 'pre_registered'}@${master.code}`;
	if (stayStatus === 'active') queueStatus = `checked_in@${master.code}`;
	else if (stayStatus === 'room_confirmed') queueStatus = `room_confirmed@${master.code}`;
	else if (stayStatus === 'arriving') queueStatus = `arriving@${master.code}`;
	else if (stayStatus === 'temporary_leave') queueStatus = `temporary_leave@${master.code}`;
	else if (stayStatus === 'checked_out') queueStatus = `checked_out@${master.code}`;
	else if (stayStatus === 'transferred') queueStatus = `transferred@${master.code}`;
	else if (stayStatus === 'cancelled') queueStatus = `cancelled@${master.code}`;
	return {
		id: `bound:${master.code}:${ev._id}`,
		source: 'bound',
		display_name: name,
		household_id: ev.household_id ?? null,
		household_name: hh?.label?.trim() || null,
		province: hh?.province ?? null,
		district: hh?.district ?? null,
		subdistrict: hh?.subdistrict ?? null,
		country: ev.country ?? null,
		birth_year: ev.birth_year ?? null,
		age: ev.age ?? null,
		age_band: ageBandForBirthYear(ev.birth_year ?? null),
		queue_status: queueStatus,
		stay_status: stayStatus,
		registered_via: ev.registered_via ?? null,
		shelter_code: master.code,
		shelter_name: master.name,
		registered_at: ev.created_at ?? ev.current_stay?.since ?? null,
		profile_href: `/system-management/pre-registrations/evacuee/${encodeURIComponent(master.code)}/${encodeURIComponent(ev._id)}`,
		registration_id: null,
		evacuee_id: ev._id
	};
}

/**
 * Default-view fast path (#1502): page at the DB via `prereg_by_created` (descending, limit =
 * offset+limit per shelter, merged in Node) instead of loading every evacuee of every shelter.
 * Only valid when no filter needs per-row data the view does not carry. Returns null when a
 * shelter DB lacks the view (stale manifest) so the caller falls back to the full scan.
 */
async function boundPageFromView(
	masters: ShelterMaster[],
	filters: OverviewFilters,
	unassigned: PreRegistrationListItem[]
): Promise<{ items: PreRegistrationListItem[]; total: number; offset: number } | null> {
	const want = filters.offset + filters.limit;
	const parts = await Promise.all(
		masters.map(async (master) => {
			const db = `shelter_${master.code.toLowerCase()}`;
			const base = `/${db}/_design/app/_view/prereg_by_created`;
			const [pageRes, countRes] = await Promise.all([
				adminRaw(`${base}?reduce=false&descending=true&include_docs=true&limit=${want}`, 'GET'),
				adminRaw(base, 'GET')
			]);
			if (pageRes.status >= 400 || countRes.status >= 400) return null;
			const docs = ((pageRes.data as { rows?: { doc?: EvacueeDoc | null }[] })?.rows ?? [])
				.map((r) => r.doc)
				.filter((d): d is EvacueeDoc => Boolean(d) && d?.type === 'evacuee');
			const count = (countRes.data as { rows?: { value: number }[] })?.rows?.[0]?.value ?? 0;
			return { master, docs, count };
		})
	);
	if (parts.some((p) => p === null)) return null;
	const ok = parts as { master: ShelterMaster; docs: EvacueeDoc[]; count: number }[];

	type Candidate = {
		at: string;
		unassigned?: PreRegistrationListItem;
		master?: ShelterMaster;
		ev?: EvacueeDoc;
	};
	const candidates: Candidate[] = [
		...unassigned.map((u) => ({ at: u.registered_at ?? '', unassigned: u })),
		...ok.flatMap((p) =>
			p.docs.map((ev) => ({
				at: ev.created_at ?? ev.current_stay?.since ?? '',
				master: p.master,
				ev
			}))
		)
	];
	candidates.sort((a, b) => b.at.localeCompare(a.at));
	const total = unassigned.length + ok.reduce((sum, p) => sum + p.count, 0);
	// Clamping only ever lowers the offset, so the `want` docs fetched above still cover the page.
	const offset = clampOffset(total, filters.offset, filters.limit);
	const page = candidates.slice(offset, offset + filters.limit);

	const idsByShelter = new Map<string, string[]>();
	for (const c of page) {
		if (c.master && c.ev?.household_id) {
			const list = idsByShelter.get(c.master.code) ?? [];
			list.push(c.ev.household_id);
			idsByShelter.set(c.master.code, list);
		}
	}
	const households = new Map<string, Map<string, HouseholdDoc>>();
	await Promise.all(
		[...idsByShelter].map(async ([code, ids]) => {
			households.set(code, await getHouseholdsByIds(code, ids));
		})
	);

	const items = page.map((c) => {
		if (c.unassigned) return c.unassigned;
		const ev = c.ev as EvacueeDoc;
		const master = c.master as ShelterMaster;
		const hh = ev.household_id ? (households.get(master.code)?.get(ev.household_id) ?? null) : null;
		return boundItem(
			master,
			ev,
			hh,
			ev.current_stay?.status ?? 'pre_registered',
			displayName(ev.first_name, ev.last_name)
		);
	});
	return { items, total, offset };
}

export async function buildPreRegistrationsList(
	filters: OverviewFilters,
	fetchFn: FastapiFetch,
	cookie: string | null
) {
	const items: PreRegistrationListItem[] = [];
	const masters = (await listShelterMasters()).map(migrate);
	const filteredMasters = masters.filter((m) => matchesShelterGeo(m, filters));

	if (
		filters.source !== 'bound' &&
		!filters.shelter_code &&
		matchesStayBucket('unassigned', filters.stay_bucket)
	) {
		const qs = new URLSearchParams({
			limit: '200',
			offset: '0'
		});
		if (filters.residence_province) qs.set('province', filters.residence_province);
		if (filters.residence_district) qs.set('district', filters.residence_district);
		if (filters.residence_subdistrict) qs.set('subdistrict', filters.residence_subdistrict);
		if (filters.q) qs.set('q', filters.q);
		const list = await fastapiJson<UnassignedList>(
			fetchFn,
			cookie,
			`/staff/v1/unassigned-registrations?${qs}`
		);
		for (const reg of list?.items ?? []) {
			if (filters.household_id && reg.reserved_household_id !== filters.household_id) {
				continue;
			}
			const hhLabel =
				reg.household.label?.trim() ||
				(reg.open_members[0]
					? `ครอบครัว ${displayName(reg.open_members[0].first_name, reg.open_members[0].last_name)}`
					: 'ครอบครัวไม่ระบุชื่อ');
			for (const member of reg.open_members) {
				const band = ageBandForBirthYear(member.birth_year ?? null);
				if (filters.age_band && band !== filters.age_band) continue;
				if (
					filters.country &&
					(member.country || '').toUpperCase() !== filters.country.toUpperCase()
				) {
					continue;
				}
				items.push({
					id: `unassigned:${reg.id}:${member.reserved_evacuee_id}`,
					source: 'unassigned',
					display_name: displayName(member.first_name, member.last_name),
					household_id: reg.reserved_household_id,
					household_name: hhLabel,
					province: reg.household.province ?? null,
					district: reg.household.district ?? null,
					subdistrict: reg.household.subdistrict ?? null,
					country: member.country ?? null,
					birth_year: member.birth_year ?? null,
					age: member.age ?? null,
					age_band: band,
					queue_status: 'unassigned',
					stay_status: 'unassigned',
					registered_via: reg.registered_via ?? 'web',
					shelter_code: null,
					shelter_name: null,
					registered_at: reg.created_at,
					profile_href: `/system-management/pre-registrations/unassigned/${encodeURIComponent(reg.id)}`,
					registration_id: reg.id,
					evacuee_id: member.reserved_evacuee_id
				});
			}
		}
	}

	const fastPathOk =
		filters.source !== 'unassigned' &&
		(!filters.stay_bucket || filters.stay_bucket === 'all') &&
		!filters.q &&
		!filters.country &&
		!filters.age_band &&
		!filters.household_id &&
		!filters.residence_province &&
		!filters.residence_district &&
		!filters.residence_subdistrict;
	if (fastPathOk) {
		const fast = await boundPageFromView(filteredMasters, filters, items);
		if (fast) {
			return preRegistrationsListPayloadSchema.parse({
				items: fast.items,
				total: fast.total,
				limit: filters.limit,
				offset: fast.offset
			});
		}
	}

	if (filters.source !== 'unassigned') {
		for (const master of filteredMasters) {
			const [evacuees, hhMap] = await Promise.all([
				findPreRegisteredEvacuees(master.code),
				getHouseholdsMap(master.code)
			]);
			for (const ev of evacuees) {
				const stayStatus = ev.current_stay?.status ?? 'pre_registered';
				if (!matchesStayBucket(stayStatus, filters.stay_bucket)) {
					continue;
				}
				if (filters.household_id && ev.household_id !== filters.household_id) {
					continue;
				}
				const hh = ev.household_id ? (hhMap.get(ev.household_id) ?? null) : null;
				if (!matchesResidence(hh?.province, hh?.district, hh?.subdistrict, filters)) {
					continue;
				}
				const band = ageBandForBirthYear(ev.birth_year ?? null);
				if (filters.age_band && band !== filters.age_band) continue;
				if (filters.country && (ev.country || '').toUpperCase() !== filters.country.toUpperCase()) {
					continue;
				}
				const name = displayName(ev.first_name, ev.last_name);
				if (filters.q) {
					const q = filters.q.toLowerCase();
					if (!name.toLowerCase().includes(q) && !(ev.phone || '').includes(filters.q)) {
						continue;
					}
				}

				items.push(boundItem(master, ev, hh, stayStatus, name));
			}
		}
	}

	items.sort((a, b) => (b.registered_at ?? '').localeCompare(a.registered_at ?? ''));
	const total = items.length;
	const offset = clampOffset(total, filters.offset, filters.limit);
	const page = items.slice(offset, offset + filters.limit);
	return preRegistrationsListPayloadSchema.parse({
		items: page,
		total,
		limit: filters.limit,
		offset
	});
}

export async function buildUnassignedProfile(
	id: string,
	fetchFn: FastapiFetch,
	cookie: string | null
): Promise<PreRegistrationProfile> {
	const detail = await fastapiJson<UnassignedDetail>(
		fetchFn,
		cookie,
		`/staff/v1/unassigned-registrations/${encodeURIComponent(id)}`
	);
	if (!detail) {
		throw new ServiceError('VALIDATION', 'Unassigned registration not found');
	}
	const head = detail.members.find((m) => m.status === 'open') ?? detail.members[0] ?? null;
	const profile = preRegistrationProfileSchema.parse({
		source: 'unassigned',
		display_name: head
			? displayName(head.first_name, head.last_name)
			: detail.reserved_household_id,
		person_id_masked: head?.person_id?.number ? maskNationalId(head.person_id.number) : null,
		phone: head?.phone ?? null,
		country: head?.country ?? null,
		birth_year: head?.birth_year ?? null,
		age: head?.age ?? null,
		vulnerable_groups: head?.vulnerable_groups ?? [],
		special_needs: head?.special_needs ?? [],
		queue_status: 'unassigned',
		shelter_code: null,
		shelter_name: null,
		shelter_href: null,
		registered_via: detail.registered_via,
		registered_at: detail.created_at,
		residence: {
			housing_type: detail.household.housing_type ?? null,
			landmark: detail.household.residence_landmark ?? null,
			address_no: detail.household.address_no ?? null,
			province: detail.household.province ?? null,
			district: detail.household.district ?? null,
			subdistrict: detail.household.subdistrict ?? null
		},
		members: detail.members.map((m) => ({
			id: m.reserved_evacuee_id,
			display_name: displayName(m.first_name, m.last_name),
			status: m.status,
			country: m.country,
			birth_year: m.birth_year ?? null
		}))
	});
	return profile;
}

export async function buildBoundEvacueeProfile(
	shelterCode: string,
	evacueeId: string
): Promise<PreRegistrationProfile> {
	const db = `shelter_${shelterCode.toLowerCase()}`;
	const res = await adminRaw(`/${db}/${encodeURIComponent(evacueeId)}`, 'GET');
	if (res.status >= 400) {
		throw new ServiceError('VALIDATION', 'Evacuee not found');
	}
	const ev = res.data as EvacueeDoc;
	if (
		ev.current_stay?.status !== 'pre_registered' &&
		ev.current_stay?.status !== 'kiosk_registered'
	) {
		throw new ServiceError(
			'VALIDATION',
			'Only pre_registered or kiosk_registered evacuees are available on this surface'
		);
	}
	const masters = (await listShelterMasters()).map(migrate);
	const master = masters.find((m) => m.code === shelterCode);
	const hh = ev.household_id
		? ((await getHouseholdsByIds(shelterCode, [ev.household_id])).get(ev.household_id) ?? null)
		: null;
	let members: PreRegistrationProfile['members'] = [];
	if (ev.household_id) {
		const findRes = await adminRaw(`/${db}/_find`, 'POST', {
			selector: { type: 'evacuee', household_id: ev.household_id },
			limit: 50
		});
		const docs =
			((findRes.data as { docs?: EvacueeDoc[] })?.docs ?? []).filter((d) => d.type === 'evacuee') ??
			[];
		members = docs.map((m) => ({
			id: m._id,
			display_name: displayName(m.first_name, m.last_name),
			status: m.current_stay?.status ?? null,
			country: m.country ?? null,
			birth_year: m.birth_year ?? null
		}));
	}

	return preRegistrationProfileSchema.parse({
		source: 'bound',
		display_name: displayName(ev.first_name, ev.last_name),
		person_id_masked: ev.person_id?.number ? maskNationalId(ev.person_id.number) : null,
		phone: ev.phone ?? null,
		country: ev.country ?? null,
		birth_year: ev.birth_year ?? null,
		age: ev.age ?? null,
		vulnerable_groups: ev.vulnerable_groups ?? [],
		special_needs: ev.special_needs ?? [],
		queue_status: `${ev.current_stay?.status === 'kiosk_registered' ? 'kiosk_registered' : 'pre_registered'}@${shelterCode}`,
		shelter_code: shelterCode,
		shelter_name: master?.name ?? shelterCode,
		shelter_href: `/back-office/evacuee-management?shelter=${encodeURIComponent(shelterCode)}`,
		registered_via: null,
		registered_at: ev.current_stay?.since ?? ev.created_at ?? null,
		residence: hh
			? {
					housing_type: hh.housing_type ?? null,
					landmark: hh.residence_landmark ?? null,
					address_no: hh.address_no ?? null,
					province: hh.province ?? null,
					district: hh.district ?? null,
					subdistrict: hh.subdistrict ?? null
				}
			: null,
		members
	});
}

export interface SearchHouseholdsOptions {
	scope?: 'universal' | 'shelter';
	shelterCode?: string | null;
	q?: string | null;
	limit?: number;
}

export async function searchHouseholds(
	options: SearchHouseholdsOptions,
	fetchFn: FastapiFetch,
	cookie: string | null
): Promise<HouseholdOption[]> {
	const { scope = 'universal', shelterCode, q = '', limit = 20 } = options;
	const trimmedQ = (q ?? '').trim().toLowerCase();
	const results: HouseholdOption[] = [];
	const seenIds = new Set<string>();

	if (scope === 'shelter') {
		if (!shelterCode) {
			throw new ServiceError('VALIDATION', 'shelter_code is required when scope is shelter');
		}
		const db = `shelter_${shelterCode.toLowerCase()}`;
		const selector: Record<string, unknown> = { type: 'household' };
		const res = await adminRaw(`/${db}/_find`, 'POST', {
			selector,
			limit: 200
		});
		if (res.status < 400 && res.data) {
			const docs = ((res.data as { docs?: HouseholdDoc[] }).docs ?? []).filter(
				(d) => d.type === 'household' || d._id?.startsWith('household:')
			);
			for (const d of docs) {
				const label = d.label?.trim() || 'ครอบครัวไม่ระบุชื่อ';
				const addr = [d.province, d.district, d.subdistrict, d.address_no]
					.filter(Boolean)
					.join(' ');
				if (trimmedQ) {
					const match =
						label.toLowerCase().includes(trimmedQ) ||
						addr.toLowerCase().includes(trimmedQ) ||
						d._id.toLowerCase().includes(trimmedQ);
					if (!match) continue;
				}
				results.push({
					id: d._id,
					label,
					status: d.status ?? 'active',
					statusLabel: `ในศูนย์: ${shelterCode}`,
					shelterCode,
					shelterName: null,
					province: d.province ?? null,
					district: d.district ?? null,
					subdistrict: d.subdistrict ?? null,
					memberCount: 0,
					memberNames: [],
					scope: 'shelter'
				});
				if (results.length >= limit) break;
			}
		}
		return results;
	}

	// Universal mode:
	// 1. Fetch unassigned registrations from FastAPI (Mongo unassigned queue)
	try {
		const qs = new URLSearchParams({ limit: '100' });
		if (trimmedQ) qs.set('q', trimmedQ);
		const list = await fastapiJson<UnassignedList>(
			fetchFn,
			cookie,
			`/staff/v1/unassigned-registrations?${qs.toString()}`
		);
		for (const reg of list?.items ?? []) {
			if (seenIds.has(reg.reserved_household_id)) continue;
			seenIds.add(reg.reserved_household_id);
			const label =
				reg.household.label?.trim() ||
				(reg.open_members[0]
					? `ครอบครัว ${displayName(reg.open_members[0].first_name, reg.open_members[0].last_name)}`
					: 'ครอบครัวไม่ระบุชื่อ');
			results.push({
				id: reg.reserved_household_id,
				label,
				status: 'unassigned',
				statusLabel: 'ยังไม่ได้เลือกศูนย์',
				shelterCode: null,
				shelterName: null,
				province: reg.household.province ?? null,
				district: reg.household.district ?? null,
				subdistrict: reg.household.subdistrict ?? null,
				memberCount: reg.open_member_count ?? reg.open_members.length,
				memberNames: reg.open_members
					.map((m) => displayName(m.first_name, m.last_name))
					.slice(0, 5),
				scope: 'universal'
			});
			if (results.length >= limit) break;
		}
	} catch {
		// continue to confirmed if FastAPI fails
	}

	// 2. Fetch confirmed / in-shelter households across shelters
	if (results.length < limit) {
		const masters = (await listShelterMasters()).map(migrate);
		const shelterPromises = masters.map(async (m) => {
			const db = `shelter_${m.code.toLowerCase()}`;
			const res = await adminRaw(`/${db}/_find`, 'POST', {
				selector: { type: 'household' },
				limit: 100
			});
			if (res.status >= 400 || !res.data) return [];
			const docs = ((res.data as { docs?: HouseholdDoc[] }).docs ?? []).filter(
				(d) => d.type === 'household' || d._id?.startsWith('household:')
			);
			return docs.map((d) => ({ doc: d, shelterCode: m.code, shelterName: m.name }));
		});

		const shelterResults = await Promise.all(shelterPromises);
		for (const items of shelterResults) {
			for (const { doc: d, shelterCode: code, shelterName: name } of items) {
				if (seenIds.has(d._id)) continue;
				const label = d.label?.trim() || 'ครอบครัวไม่ระบุชื่อ';
				const addr = [d.province, d.district, d.subdistrict, d.address_no]
					.filter(Boolean)
					.join(' ');
				if (trimmedQ) {
					const match =
						label.toLowerCase().includes(trimmedQ) ||
						addr.toLowerCase().includes(trimmedQ) ||
						d._id.toLowerCase().includes(trimmedQ);
					if (!match) continue;
				}
				seenIds.add(d._id);
				results.push({
					id: d._id,
					label,
					status: d.status ?? 'checked_in',
					statusLabel: `อยู่ในศูนย์: ${name || code}`,
					shelterCode: code,
					shelterName: name,
					province: d.province ?? null,
					district: d.district ?? null,
					subdistrict: d.subdistrict ?? null,
					memberCount: 0,
					memberNames: [],
					scope: 'universal'
				});
				if (results.length >= limit) break;
			}
			if (results.length >= limit) break;
		}
	}

	return results;
}

export { parseOverviewFilters, noStore };
