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
import { resolveOperationStatus, type ShelterMaster } from '$lib/features/shelters/server';
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
	const op = resolveOperationStatus(master) ?? '';
	if (filters.operation_status && op !== filters.operation_status) return false;
	if (filters.shelter_code && master.code !== filters.shelter_code) return false;
	return true;
}

type StatusCounts = Record<string, number>;

async function occupancyCounts(code: string): Promise<StatusCounts> {
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
	const counts: StatusCounts = {};
	if (res.status >= 400) return counts;
	const rows = (res.data as { rows?: { key: string; value: number }[] })?.rows ?? [];
	for (const row of rows) counts[row.key] = (counts[row.key] ?? 0) + row.value;
	return counts;
}

async function movementTotals(
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
	if (res.status >= 400) return { checkin, checkout };
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

	// One Mango pass so we can cross-tab age × country (views only expose each axis alone).
	const findRes = await adminRaw(`/${db}/_find`, 'POST', {
		selector: { type: 'evacuee', 'current_stay.status': 'active' },
		fields: ['birth_year', 'country'],
		limit: 50_000
	});

	if (findRes.status < 400) {
		const docs =
			(
				findRes.data as {
					docs?: { birth_year?: number | null; country?: string | null }[];
				}
			)?.docs ?? [];
		for (const doc of docs) {
			const country = (doc.country || '').trim().toUpperCase() || 'UNKNOWN';
			const band = ageBandForBirthYear(
				typeof doc.birth_year === 'number' ? doc.birth_year : null,
				currentYear
			);
			ageGroups[band] += 1;
			countries[country] = (countries[country] ?? 0) + 1;
			const perCountry = ageByCountry[country] ?? emptyAgeGroups();
			perCountry[band] += 1;
			ageByCountry[country] = perCountry;
		}
		return { age_groups: ageGroups, countries, age_by_country: ageByCountry };
	}

	// Fallback: independent views (no per-country age cross-tab).
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
			const pre_registered = counts.pre_registered ?? 0;
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

	const present_total = sites.reduce((s, x) => s + x.present, 0);
	const forecast_total = sites.reduce((s, x) => s + x.forecast, 0);
	const pre_registered_at_sites = sites.reduce((s, x) => s + x.pre_registered, 0);
	const capacity_total = sites.reduce((s, x) => s + x.capacity, 0);

	const sites_by_status: Record<string, number> = {};
	for (const s of sites) {
		sites_by_status[s.operation_status] = (sites_by_status[s.operation_status] ?? 0) + 1;
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
		checkouts_in_window: checkouts,
		sites_closed: sites.filter((s) => s.operation_status === 'closed').length,
		sites_open_with_present: sites.filter((s) => s.operation_status !== 'closed' && s.present > 0)
			.length,
		sites_total: sites.length,
		movement_window: filters.movement_window
	});
}

export async function buildOverviewSites(filters: OverviewFilters) {
	const sites = await loadSiteMetrics(filters);
	const { from, to } = resolveMovementDateRange(filters);
	const rows = await Promise.all(
		sites.map(async (s) => {
			const movements = await movementTotals(s.master.code, from, to);
			return {
				...s.row,
				checkin: movements.checkin,
				checkout: movements.checkout
			} satisfies OverviewSiteRow;
		})
	);
	rows.sort((a, b) => (b.forecast_pct ?? -1) - (a.forecast_pct ?? -1));
	return overviewSitesPayloadSchema.parse({ sites: rows });
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
};

type HouseholdDoc = {
	_id: string;
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
		selector: { type: 'evacuee', 'current_stay.status': 'pre_registered' },
		limit: 10_000
	});
	if (res.status >= 400) return [];
	return ((res.data as { docs?: EvacueeDoc[] })?.docs ?? []).filter((d) => d.type === 'evacuee');
}

async function getHousehold(code: string, householdId: string): Promise<HouseholdDoc | null> {
	if (!householdId) return null;
	const db = `shelter_${code.toLowerCase()}`;
	const res = await adminRaw(`/${db}/${encodeURIComponent(householdId)}`, 'GET');
	if (res.status >= 400) return null;
	return res.data as HouseholdDoc;
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
			for (const ev of evacuees) {
				const hh = ev.household_id ? await getHousehold(site.master.code, ev.household_id) : null;
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

export async function buildPreRegistrationsList(
	filters: OverviewFilters,
	fetchFn: FastapiFetch,
	cookie: string | null
) {
	const items: PreRegistrationListItem[] = [];
	const nameByCode = new Map<string, string>();
	const masters = (await listShelterMasters()).map(migrate);
	for (const m of masters) nameByCode.set(m.code, m.name);
	const filteredMasters = masters.filter((m) => matchesShelterGeo(m, filters));

	if (filters.source !== 'bound') {
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
					province: reg.household.province ?? null,
					district: reg.household.district ?? null,
					subdistrict: reg.household.subdistrict ?? null,
					country: member.country ?? null,
					birth_year: member.birth_year ?? null,
					age: member.age ?? null,
					age_band: band,
					queue_status: 'unassigned',
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

	if (filters.source !== 'unassigned') {
		for (const master of filteredMasters) {
			const evacuees = await findPreRegisteredEvacuees(master.code);
			for (const ev of evacuees) {
				const hh = ev.household_id ? await getHousehold(master.code, ev.household_id) : null;
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
				items.push({
					id: `bound:${master.code}:${ev._id}`,
					source: 'bound',
					display_name: name,
					province: hh?.province ?? null,
					district: hh?.district ?? null,
					subdistrict: hh?.subdistrict ?? null,
					country: ev.country ?? null,
					birth_year: ev.birth_year ?? null,
					age: ev.age ?? null,
					age_band: band,
					queue_status: `pre_registered@${master.code}`,
					shelter_code: master.code,
					shelter_name: nameByCode.get(master.code) ?? master.name,
					registered_at: ev.current_stay?.since ?? ev.created_at ?? null,
					profile_href: `/system-management/pre-registrations/evacuee/${encodeURIComponent(master.code)}/${encodeURIComponent(ev._id)}`,
					registration_id: null,
					evacuee_id: ev._id
				});
			}
		}
	}

	items.sort((a, b) => (b.registered_at ?? '').localeCompare(a.registered_at ?? ''));
	const total = items.length;
	const page = items.slice(filters.offset, filters.offset + filters.limit);
	return preRegistrationsListPayloadSchema.parse({
		items: page,
		total,
		limit: filters.limit,
		offset: filters.offset
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
	if (ev.current_stay?.status !== 'pre_registered') {
		throw new ServiceError(
			'VALIDATION',
			'Only pre_registered evacuees are available on this surface'
		);
	}
	const masters = (await listShelterMasters()).map(migrate);
	const master = masters.find((m) => m.code === shelterCode);
	const hh = ev.household_id ? await getHousehold(shelterCode, ev.household_id) : null;
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
		queue_status: `pre_registered@${shelterCode}`,
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

export { parseOverviewFilters, noStore };
