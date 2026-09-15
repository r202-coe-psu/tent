/**
 * daily_calc (SH001) + daily_sop (SH001–SH004) staging snapshots.
 */
import { makeDoc } from '$lib/db/model';
import { parseStockLedger, stockBalance } from '$lib/features/operations/domain/operations';
import {
	SOP_RATIO_KIND,
	sopMasterSchema,
	type SopRatioKey
} from '$lib/features/sop-ratios/domain/sop-ratio';
import {
	calculateResources,
	FORMULA_V,
	type ResourceInput
} from '$lib/features/resource-calc/domain/calc.formula';
import {
	parseDailyCalcRecord,
	resolveHave,
	type ShelterHaveSource
} from '$lib/features/resource-calc/core';
import {
	dailyCalcDocSchema,
	DAILY_CALC_SCHEMA_VERSION
} from '$lib/features/resource-calc/domain/calc.schema';
import {
	DAILY_SOP_DOCUMENT_TYPE,
	DAILY_SOP_QUESTIONS,
	DAILY_SOP_SCHEMA_VERSION,
	LIFELINE_KEYS
} from '$lib/features/daily-sop/domain/daily-sop';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { prefixRangeEnd } from '../t31-seed-support';
import { bulkDocs, couchReq, ensureDb } from './couch';
import { SH001_CODE, SH002_CODE, SH003_CODE, SH004_CODE } from './types';

const DAILY_CALC_DAYS = 14;
const SH001_DB = shelterDbName(SH001_CODE);
const SH001_CTX = { shelterCode: SH001_CODE, createdBy: 'seed' as const };

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readSeedStockBalance(): Promise<Map<string, string>> {
	const startkey = encodeURIComponent(JSON.stringify('stock_ledger:'));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd('stock_ledger:')));
	const { status, data } = await couchReq(
		'GET',
		`/${SH001_DB}/_all_docs?include_docs=true&startkey=${startkey}&endkey=${endkey}`
	);
	if (status !== 200) {
		throw new Error(`Cannot read stock ledger from "${SH001_DB}" (HTTP ${status})`);
	}

	const rows = (data as { rows?: { doc?: unknown }[] }).rows ?? [];
	const ledger = rows.map((row, index) => {
		if (row.doc === undefined) throw new Error(`Missing stock_ledger document at row ${index}`);
		return parseStockLedger(row.doc);
	});
	return stockBalance(ledger);
}

async function readSeedShelterSource(): Promise<ShelterHaveSource> {
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status !== 200) throw new Error(`Cannot read shelter registry (HTTP ${status})`);

	const rows = (data as { rows?: { doc?: unknown }[] }).rows ?? [];
	const shelter = rows
		.map((row) => row.doc)
		.find((doc): doc is Record<string, unknown> => {
			if (!doc || typeof doc !== 'object') return false;
			const candidate = doc as Record<string, unknown>;
			return candidate.type === 'shelter' && candidate.code === SH001_CODE;
		});
	if (!shelter) throw new Error(`Cannot find shelter ${SH001_CODE} in registry`);

	const facilities =
		shelter.facilities && typeof shelter.facilities === 'object'
			? (shelter.facilities as Record<string, unknown>)
			: {};

	return {
		area_m2: finiteNumber(shelter.area_m2),
		facilities: {
			water_points: finiteNumber(facilities.water_points),
			showers: finiteNumber(facilities.showers),
			toilets_female: finiteNumber(facilities.toilets_female),
			toilets_male: finiteNumber(facilities.toilets_male)
		}
	};
}

export async function seedDailyCalc(): Promise<void> {
	await ensureDb(SH001_DB);

	const { status, data } = await couchReq(
		'GET',
		`/catalog/${encodeURIComponent('sop_profile:master_sphere_baseline')}`
	);
	if (status !== 200) {
		throw new Error(`Cannot read persisted master SOP profile (HTTP ${status})`);
	}
	const master = sopMasterSchema.parse(data);
	if (!master.active) throw new Error('Persisted master SOP profile is not active');

	const ratios: Record<SopRatioKey, string> = master.ratios;
	const sopVersion = master.version;
	const [stock, shelter] = await Promise.all([readSeedStockBalance(), readSeedShelterSource()]);

	const today = new Date();
	const records: unknown[] = [];

	for (let back = DAILY_CALC_DAYS - 1; back >= 0; back--) {
		const day = new Date(today);
		day.setDate(day.getDate() - back);
		const date = isoDay(day);
		const asOf = `${date}T09:00:00.000Z`;

		const phase = ((DAILY_CALC_DAYS - 1 - back) / DAILY_CALC_DAYS) * Math.PI * 2;
		const jitter = ((back * 7) % 11) - 5;
		// Scale mock occupancy toward staging volume (~450 present-ish)
		const occupancy = Math.max(0, Math.round(380 + 40 * Math.sin(phase) + jitter));

		const resources: ResourceInput[] = [];
		const ratioSnapshot: Record<string, string> = {};
		const stockSnapshot: Record<string, string | null> = {};

		for (const key of Object.keys(ratios) as SopRatioKey[]) {
			const ratioStr = ratios[key];
			const kind = SOP_RATIO_KIND[key];
			const have = resolveHave(key, { stock, shelter });
			resources.push({ key, kind, ratio: ratioStr, have });
			ratioSnapshot[key] = ratioStr;
			stockSnapshot[key] = have;
		}

		const results = calculateResources({ occupancy, as_of: asOf, resources });
		const body = dailyCalcDocSchema.parse({
			formula_v: FORMULA_V,
			sop_profile_version: sopVersion,
			ratio_source: 'master',
			sop_override_id: null,
			sop_override_version: null,
			ratio_snapshot: ratioSnapshot,
			occupancy_snapshot: occupancy,
			as_of: asOf,
			stock_snapshot: stockSnapshot,
			results
		});

		const record = makeDoc('daily_calc', DAILY_CALC_SCHEMA_VERSION, body, SH001_CTX, date);
		parseDailyCalcRecord(record);
		records.push(record);
	}

	try {
		await bulkDocs(SH001_DB, records, { allowConflicts: false });
		console.log(
			`  ✓ ${SH001_DB}: ${records.length} daily_calc snapshots seeded (mock occupancy ~380, engine ${FORMULA_V})`
		);
	} catch {
		console.log(`  ✓ ${SH001_DB}: daily_calc snapshots already present, skipping`);
	}
}

type DailySopSeedTarget = { code: string; db: string; assessor: string };

const DAILY_SOP_SEED_TARGETS: readonly DailySopSeedTarget[] = [
	{ code: SH001_CODE, db: shelterDbName(SH001_CODE), assessor: 'พนักงานประจำศูนย์ หาดใหญ่' },
	{
		code: SH002_CODE,
		db: shelterDbName(SH002_CODE),
		assessor: 'เจ้าหน้าที่ศูนย์เทศบาลนครหาดใหญ่'
	},
	{ code: SH003_CODE, db: shelterDbName(SH003_CODE), assessor: 'พนักงานประจำศูนย์ บ้านพรุ' },
	{
		code: SH004_CODE,
		db: shelterDbName(SH004_CODE),
		assessor: 'ผู้ประสานงานบ้านพี่เลี้ยง คอหงส์'
	}
];

function dailySopSeedSnapshot(
	target: DailySopSeedTarget,
	date: string,
	time: string,
	progress: number,
	statuses: Partial<Record<number, 'No' | 'Pending'>> = {}
) {
	const passPercent = Math.round(
		(DAILY_SOP_QUESTIONS.filter((_, index) => statuses[index] === undefined).length /
			DAILY_SOP_QUESTIONS.length) *
			100
	);
	const checkedAt = `${date}T${time}+07:00`;
	return makeDoc(
		DAILY_SOP_DOCUMENT_TYPE,
		DAILY_SOP_SCHEMA_VERSION,
		{
			assessment_date: date,
			assessed_at: checkedAt,
			assessor_name: target.assessor,
			status: 'Completed',
			progress_percent: progress,
			pass_percent: passPercent,
			risk_label: Object.keys(statuses).length === 0 ? 'ไม่พบความเสี่ยง' : 'พบความเสี่ยง',
			controls: DAILY_SOP_QUESTIONS.map((question, index) => ({
				id: question.id,
				section_id: question.sectionId,
				question: question.prompt,
				status: statuses[index] ?? 'Yes',
				answered: true,
				checked_by: target.assessor,
				checked_at: checkedAt
			})),
			lifelines: Object.fromEntries(LIFELINE_KEYS.map((key) => [key, 'Operational']))
		},
		{ shelterCode: target.code, createdBy: 'seed' },
		`${target.code}:${date}`
	);
}

export async function seedDailySop(): Promise<void> {
	for (const target of DAILY_SOP_SEED_TARGETS) {
		await ensureDb(target.db);
		const records = [
			dailySopSeedSnapshot(target, '2026-06-09', '16:15:00', 85, {
				15: 'No',
				16: 'Pending',
				17: 'Pending',
				18: 'Pending'
			}),
			dailySopSeedSnapshot(target, '2026-06-10', '15:30:00', 100, { 4: 'No', 12: 'Pending' }),
			dailySopSeedSnapshot(target, '2026-06-11', '15:00:00', 100)
		];
		await bulkDocs(target.db, records, { allowConflicts: true });
		console.log(`  ✓ ${target.db}: ${records.length} Daily SOP snapshots seeded`);
	}
}

export async function deleteDailySopData(): Promise<void> {
	for (const target of DAILY_SOP_SEED_TARGETS) {
		const ids = ['2026-06-09', '2026-06-10', '2026-06-11'].map(
			(date) => `${DAILY_SOP_DOCUMENT_TYPE}:${target.code}:${date}`
		);
		const docs: { _id: string; _rev: string; _deleted: true }[] = [];
		for (const id of ids) {
			const { status, data } = await couchReq('GET', `/${target.db}/${encodeURIComponent(id)}`);
			if (status === 200) {
				const rev = (data as { _rev: string })._rev;
				docs.push({ _id: id, _rev: rev, _deleted: true });
			}
		}
		if (docs.length > 0) await bulkDocs(target.db, docs, { allowConflicts: false });
		console.log(`  ✓ ${target.db}: removed ${docs.length} Daily SOP seed snapshots`);
	}
}

/** Legacy GenName dashboard delete — no-op friendly for old IDs if present. */
export async function deleteDashboardData(): Promise<void> {
	const startkey = encodeURIComponent(JSON.stringify('evacuee:seed-genname-'));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd('evacuee:seed-genname-')));
	const { status, data } = await couchReq(
		'GET',
		`/${SH001_DB}/_all_docs?include_docs=true&startkey=${startkey}&endkey=${endkey}`
	);
	if (status !== 200) {
		console.log(`  · ${SH001_DB}: cannot list GenName docs (HTTP ${status})`);
		return;
	}
	const rows =
		(data as { rows: { doc: { _id: string; _rev: string } & Record<string, unknown> }[] }).rows ??
		[];
	const toDelete = rows
		.map((r) => r.doc)
		.filter((d) => d?._id && d?._rev)
		.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true as const }));

	// Also purge daily_calc
	const dcStart = encodeURIComponent(JSON.stringify('daily_calc:'));
	const dcEnd = encodeURIComponent(JSON.stringify(prefixRangeEnd('daily_calc:')));
	const dc = await couchReq(
		'GET',
		`/${SH001_DB}/_all_docs?include_docs=true&startkey=${dcStart}&endkey=${dcEnd}`
	);
	if (dc.status === 200) {
		const dcRows = (dc.data as { rows: { doc?: { _id?: string; _rev?: string } }[] }).rows ?? [];
		for (const row of dcRows) {
			if (row.doc?._id && row.doc._rev) {
				toDelete.push({ _id: row.doc._id, _rev: row.doc._rev, _deleted: true });
			}
		}
	}

	if (toDelete.length > 0) await bulkDocs(SH001_DB, toDelete, { allowConflicts: false });
	console.log(`  ✓ ${SH001_DB}: removed ${toDelete.length} GenName/daily_calc docs`);
}
