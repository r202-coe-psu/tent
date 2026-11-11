#!/usr/bin/env tsx
/**
 * One-off production-readiness cleanup: clear test operations out of every shelter so the system
 * can go live with its master data, users and shelters intact.
 *
 * People (category `people`, shelter_* DBs + central_ops):
 *   - Evacuee already `pre_registered` or `cancelled` → untouched (not in a shelter).
 *   - Evacuee that came through a pre-registration channel (`registered_via` ∈ --keep-channels,
 *     default `web,api`) → reset to `current_stay = { status: 'pre_registered', zone: null }`.
 *   - Every other evacuee → deleted together with its `medical` doc and its photo `image`.
 *   - Every `movement`, `screening`, `station_log`, `people_import_log` → deleted (check-in and
 *     import history); `evacuee_qr` only for deleted evacuees (kept people's printed QR stays valid).
 *   - Households: no member left → deleted (+ pet/asset images); otherwise status re-derived
 *     (`deriveHouseholdStatus`), `checkout_destination` cleared, head moved to a kept member.
 *   - central_ops `referral`, `referral_close_job`, `referral_close_lock` → deleted.
 * Supplies (categories `stock`, `food`, `distribution`, `tickets`, `donations`): every doc of the
 *   `_id` prefixes in {@link CATEGORY_PREFIXES} is deleted; central_ops `stock_transfer` too.
 *
 * Kept on purpose: registry (shelters, config, master_data), the central `catalog` DB (item_master,
 * recipes, …), _users, volunteers/jobs/shifts, incidents, audits, donation_slot, sop_override.
 * MongoDB is not written: the running sync worker turns these CouchDB writes into projection
 * updates/deletes (keep it running during --apply).
 *
 * Usage (from frontend/) — runbook: scripts/prod-readiness-cleanup.md:
 *   pnpm migrate:prod-cleanup                                  # dry-run (default), all shelters
 *   pnpm migrate:prod-cleanup --shelter=SH001                  # dry-run one shelter
 *   pnpm migrate:prod-cleanup --only=stock,food                # limit categories
 *   pnpm migrate:prod-cleanup --apply                          # backup, then write (local host)
 *   pnpm migrate:prod-cleanup --apply --confirm-host=<host> --expect-shelters=<n>
 *                                                              # any other host (incl. `couchdb`)
 *   pnpm migrate:prod-cleanup --restore=<backup-dir> [--apply] # put backed-up docs back
 *
 * --apply needs COUCHDB_ADMIN_URL set explicitly (no localhost fallback) and always exports every
 * touched database (docs + attachments, owner-only file mode) to --backup-dir first
 * (default `backups/prod-cleanup/<host>-<timestamp>/`, gitignored — it holds PII). Re-runnable:
 * a second run finds nothing left to do.
 *
 * Needs: COUCHDB_ADMIN_URL in the environment or frontend/.env.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	deriveHouseholdStatus,
	type HouseholdStatus,
	type StayStatus
} from '$lib/features/people/domain/people';
import { couchReq, displayCouchUrl, env, rawCouchUrl } from './seed/couch';
import { assertBulkWriteResults, type BulkWriteResult } from './t31-seed-support';
import { resolveShelterTarget, type CouchReq } from './unseed-stock';

export const CATEGORIES = [
	'people',
	'stock',
	'food',
	'distribution',
	'tickets',
	'donations'
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Shelter-DB `_id` prefixes deleted outright, per category (people is planned per doc). */
export const CATEGORY_PREFIXES: Record<Exclude<Category, 'people'>, readonly string[]> = {
	stock: [
		'stock_ledger:',
		'lot_counter:',
		'stock_lot_reservation:',
		'stock_threshold_override:',
		'item_master:'
	],
	food: [
		'meal_plan:',
		'kitchen_requisition:',
		'meal_service:',
		'meal_service_receipt:',
		'fuel_cylinder:',
		'gas_ledger:',
		'daily_calc:'
	],
	distribution: [
		'distribution_request:',
		'distribution_batch:',
		'distribution_issue:',
		'distribution_issue_idempotency:',
		'distribution_issue_capacity:',
		'distribution_one_time_guard:',
		'distribution_issue_gate:',
		'distribution_log:',
		'bulk_return_pool:',
		'bulk_return_entry:',
		'bulk_return_entry_move:',
		'bulk_return_entry_void:',
		'bulk_return_loan_reopen:',
		'bulk_return_claim:',
		'loan_return_reservation:'
	],
	tickets: ['requisition_ticket:'],
	donations: ['donation:', 'donation_redirect:', 'donation_campaign:']
};

/** Check-in and import history — deleted for kept and removed people alike. */
export const PEOPLE_HISTORY_PREFIXES = [
	'movement:',
	'screening:',
	'station_log:',
	'people_import_log:'
] as const;

export const CENTRAL_OPS_DB = 'central_ops';
export const CENTRAL_OPS_PREFIXES: Partial<Record<Category, readonly string[]>> = {
	people: ['referral:', 'referral_close_job:', 'referral_close_lock:'],
	stock: ['stock_transfer:']
};

export const DEFAULT_KEEP_CHANNELS = ['web', 'api'] as const;
const UNTOUCHED_STAYS: readonly string[] = ['pre_registered', 'cancelled'];
/** `shelter_{code}` — excludes service DBs such as `shelter_import_queue`. */
const SHELTER_DB_PATTERN = /^shelter_[a-z0-9-]+$/;
/** Hosts that skip `--confirm-host`. Not `couchdb`: staging/production reach Couch by that name. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Paging / chunk sizes; tests shrink them to exercise the multi-page paths. */
export type IoSizes = { pageSize: number; attachmentPageSize: number; bulkChunk: number };
const DEFAULT_SIZES: IoSizes = { pageSize: 1000, attachmentPageSize: 50, bulkChunk: 500 };

export type CouchDoc = {
	_id: string;
	_rev?: string;
	_deleted?: boolean;
	type?: string;
	[key: string]: unknown;
};

export type DocRef = { id: string; rev: string };

export type ShelterPlan = {
	db: string;
	/** `${registered_via}/${status}` → count, for the dry-run breakdown. */
	evacueesDeleted: Record<string, number>;
	evacueesReset: Record<string, number>;
	evacueesUntouched: number;
	householdsDeleted: number;
	householdsUpdated: number;
	/** `_id` prefix (`movement`, `stock_ledger`, …) → count of docs deleted. */
	deletedByType: Record<string, number>;
	updates: CouchDoc[];
	deletes: DocRef[];
};

export type CleanupOptions = {
	categories: readonly Category[];
	keepChannels: readonly string[];
	now: string;
};

function bump(map: Record<string, number>, key: string): void {
	map[key] = (map[key] ?? 0) + 1;
}

function typeOfId(id: string): string {
	return id.slice(0, id.indexOf(':'));
}

function stayOf(doc: CouchDoc): StayStatus {
	return ((doc.current_stay as { status?: string } | undefined)?.status ?? 'unknown') as StayStatus;
}

function imageIdsOfHousehold(doc: CouchDoc): string[] {
	const pets = (doc.pets as Array<{ image_url?: unknown }> | undefined) ?? [];
	const assets = doc.assets as { image_url?: unknown } | null | undefined;
	return [...pets.map((p) => p.image_url), assets?.image_url].filter(
		(v): v is string => typeof v === 'string' && v.startsWith('image:')
	);
}

/** What happens to one evacuee: left alone, reset to pre-registered, or deleted. */
export function classifyEvacuee(
	doc: CouchDoc,
	keepChannels: readonly string[]
): 'untouched' | 'reset' | 'delete' {
	if (UNTOUCHED_STAYS.includes(stayOf(doc))) return 'untouched';
	return keepChannels.includes(String(doc.registered_via)) ? 'reset' : 'delete';
}

/** Pure plan for one shelter DB from its full doc list — no I/O. */
export function planShelterCleanup(
	db: string,
	docs: readonly CouchDoc[],
	options: CleanupOptions
): ShelterPlan {
	const plan: ShelterPlan = {
		db,
		evacueesDeleted: {},
		evacueesReset: {},
		evacueesUntouched: 0,
		householdsDeleted: 0,
		householdsUpdated: 0,
		deletedByType: {},
		updates: [],
		deletes: []
	};
	const byId = new Map(docs.filter((d) => !d._id.startsWith('_')).map((d) => [d._id, d]));
	const deleteIds = new Set<string>();
	const markDelete = (id: string) => {
		if (byId.has(id)) deleteIds.add(id);
	};

	const prefixes = options.categories.flatMap((c) => (c === 'people' ? [] : CATEGORY_PREFIXES[c]));
	for (const id of byId.keys()) {
		if (prefixes.some((p) => id.startsWith(p))) markDelete(id);
	}

	if (options.categories.includes('donations')) {
		for (const doc of byId.values()) {
			if (doc.type === 'image' && doc.purpose === 'donation') markDelete(doc._id);
		}
	}

	if (options.categories.includes('people')) {
		planPeople(byId, options, plan, markDelete);
	}

	for (const id of [...deleteIds].sort()) {
		const doc = byId.get(id)!;
		if (!doc._rev) continue;
		plan.deletes.push({ id, rev: doc._rev });
		bump(plan.deletedByType, typeOfId(id));
	}
	return plan;
}

function planPeople(
	byId: Map<string, CouchDoc>,
	options: CleanupOptions,
	plan: ShelterPlan,
	markDelete: (id: string) => void
): void {
	const evacuees = [...byId.values()].filter((d) => d._id.startsWith('evacuee:'));
	const removed = new Set<string>();
	/** Evacuee id → stay status after cleanup, for kept people only. */
	const keptStay = new Map<string, StayStatus>();

	for (const doc of evacuees) {
		const key = `${String(doc.registered_via ?? 'unknown')}/${stayOf(doc)}`;
		const action = classifyEvacuee(doc, options.keepChannels);
		if (action === 'untouched') {
			plan.evacueesUntouched += 1;
			keptStay.set(doc._id, stayOf(doc));
		} else if (action === 'reset') {
			bump(plan.evacueesReset, key);
			keptStay.set(doc._id, 'pre_registered');
			plan.updates.push({
				...doc,
				current_stay: { status: 'pre_registered', zone: null, since: options.now },
				updated_at: options.now
			});
		} else {
			bump(plan.evacueesDeleted, key);
			removed.add(doc._id);
			markDelete(doc._id);
			if (typeof doc.photo === 'string') markDelete(doc.photo);
		}
	}

	for (const doc of byId.values()) {
		if (PEOPLE_HISTORY_PREFIXES.some((p) => doc._id.startsWith(p))) markDelete(doc._id);
		const removedOwner = doc._id.startsWith('medical:') || doc._id.startsWith('evacuee_qr:');
		if (removedOwner && removed.has(String(doc.evacuee_id))) markDelete(doc._id);
	}

	const membersByHousehold = new Map<string, string[]>();
	for (const doc of evacuees) {
		if (!keptStay.has(doc._id) || typeof doc.household_id !== 'string') continue;
		const list = membersByHousehold.get(doc.household_id) ?? [];
		list.push(doc._id);
		membersByHousehold.set(doc.household_id, list);
	}

	for (const hh of byId.values()) {
		if (!hh._id.startsWith('household:')) continue;
		const members = (membersByHousehold.get(hh._id) ?? []).sort();
		if (members.length === 0) {
			plan.householdsDeleted += 1;
			markDelete(hh._id);
			for (const imageId of imageIdsOfHousehold(hh)) markDelete(imageId);
			continue;
		}
		const status: HouseholdStatus = deriveHouseholdStatus(members.map((m) => keptStay.get(m)!));
		const head =
			typeof hh.head_evacuee_id === 'string' && members.includes(hh.head_evacuee_id)
				? hh.head_evacuee_id
				: members[0];
		const checkout = hh.checkout_destination ?? null;
		if (hh.status === status && hh.head_evacuee_id === head && checkout === null) continue;
		plan.householdsUpdated += 1;
		plan.updates.push({
			...hh,
			status,
			head_evacuee_id: head,
			checkout_destination: null,
			updated_at: options.now
		});
	}
}

/** Pure plan for central_ops: delete referral / stock_transfer docs of the chosen categories. */
export function planCentralOpsCleanup(
	docs: readonly CouchDoc[],
	categories: readonly Category[]
): DocRef[] {
	const prefixes = categories.flatMap((c) => CENTRAL_OPS_PREFIXES[c] ?? []);
	return docs
		.filter((d) => d._rev && prefixes.some((p) => d._id.startsWith(p)))
		.map((d) => ({ id: d._id, rev: d._rev! }))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ── CLI args ───────────────────────────────────────────────────────────────────────────────

export type CliArgs = {
	apply: boolean;
	shelter: string;
	categories: Category[];
	keepChannels: string[];
	confirmHost: string | null;
	expectShelters: number | null;
	backupDir: string | null;
	restore: string | null;
	help: boolean;
};

/** Value of `--name=v` / `--name v`; a flag given without a value throws (never "all"). */
function flagValue(argv: readonly string[], name: string): string | null {
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	const idx = argv.indexOf(`--${name}`);
	if (!eq && idx < 0) return null;
	const raw = eq ? eq.slice(name.length + 3) : argv[idx + 1];
	const value = raw?.startsWith('--') ? '' : (raw?.trim() ?? '');
	if (!value) throw new Error(`--${name} needs a value`);
	return value;
}

function listValue(raw: string | null): string[] | null {
	return raw
		? raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: null;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
	if (argv.includes('--apply') && argv.includes('--dry-run')) {
		throw new Error('--apply and --dry-run are mutually exclusive');
	}
	const only = listValue(flagValue(argv, 'only'));
	if (only && only.length === 0) throw new Error('--only needs at least one category');
	const expectRaw = flagValue(argv, 'expect-shelters');
	const expectShelters = expectRaw === null ? null : Number(expectRaw);
	if (expectShelters !== null && !(Number.isInteger(expectShelters) && expectShelters >= 0)) {
		throw new Error(`--expect-shelters must be a whole number, got "${expectRaw}"`);
	}
	const unknown = (only ?? []).filter((c) => !(CATEGORIES as readonly string[]).includes(c));
	if (unknown.length) {
		throw new Error(
			`Unknown --only categories: ${unknown.join(', ')} (use ${CATEGORIES.join(',')})`
		);
	}
	return {
		apply: argv.includes('--apply'),
		shelter: flagValue(argv, 'shelter') ?? 'all',
		categories: (only as Category[] | null) ?? [...CATEGORIES],
		keepChannels: listValue(flagValue(argv, 'keep-channels')) ?? [...DEFAULT_KEEP_CHANNELS],
		confirmHost: flagValue(argv, 'confirm-host'),
		expectShelters,
		backupDir: flagValue(argv, 'backup-dir'),
		restore: flagValue(argv, 'restore'),
		help: argv.includes('--help') || argv.includes('-h')
	};
}

export function isLocalHost(couchUrl: string): boolean {
	return LOCAL_HOSTS.has(new URL(couchUrl).hostname);
}

/** Non-local CouchDB needs `--confirm-host=<exact hostname>` before anything is written. */
export function assertHostConfirmed(couchUrl: string, confirmHost: string | null): void {
	const host = new URL(couchUrl).hostname;
	if (LOCAL_HOSTS.has(host)) return;
	if (confirmHost !== host) {
		throw new Error(
			`CouchDB host "${host}" is not local — re-run with --confirm-host=${host} to write to it`
		);
	}
}

/**
 * Staging and production both reach Couch as `couchdb`, so the hostname cannot tell them apart:
 * off localhost, --apply also needs the shelter count seen in the dry-run.
 */
export function assertExpectedShelters(
	couchUrl: string,
	expected: number | null,
	found: number
): void {
	if (isLocalHost(couchUrl)) return;
	if (expected !== found) {
		throw new Error(
			`Found ${found} shelter database(s) — re-run with --expect-shelters=${found} after checking the dry-run`
		);
	}
}

/** The admin URL the operator set (env or frontend/.env) — never the seed localhost fallback. */
function explicitAdminUrl(): string | null {
	return process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL ?? null;
}

function targetCouchUrl(apply: boolean, given: string | undefined): string {
	if (given) return given;
	const explicit = explicitAdminUrl();
	if (explicit) return explicit;
	if (apply) {
		throw new Error('COUCHDB_ADMIN_URL is not set — --apply/--restore never use a default URL');
	}
	return rawCouchUrl;
}

// ── CouchDB I/O ────────────────────────────────────────────────────────────────────────────

function httpError(what: string, res: { status: number; data: unknown }): Error {
	const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
	return new Error(`${what} (HTTP ${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`);
}

/** Every doc of `db`, paged by `_id`; `attachments` inlines attachment bytes (for backups). */
export async function fetchAllDocs(
	db: string,
	req: CouchReq,
	options: { attachments?: boolean; sizes?: IoSizes } = {}
): Promise<CouchDoc[]> {
	const sizes = options.sizes ?? DEFAULT_SIZES;
	const pageSize = options.attachments ? sizes.attachmentPageSize : sizes.pageSize;
	const out: CouchDoc[] = [];
	let startkey: string | null = null;
	for (;;) {
		const params = new URLSearchParams({ include_docs: 'true', limit: String(pageSize) });
		if (options.attachments) params.set('attachments', 'true');
		if (startkey !== null) {
			params.set('startkey', JSON.stringify(startkey));
			params.set('skip', '1');
		}
		const res = await req('GET', `/${encodeURIComponent(db)}/_all_docs?${params}`);
		if (res.status !== 200) throw httpError(`Cannot read "${db}"`, res);
		const rows = (res.data as { rows?: Array<{ id: string; doc?: CouchDoc }> }).rows ?? [];
		for (const row of rows) if (row.doc) out.push(row.doc);
		if (rows.length < pageSize) return out;
		startkey = rows[rows.length - 1].id;
	}
}

async function bulkWrite(
	db: string,
	docs: CouchDoc[],
	req: CouchReq,
	sizes: IoSizes = DEFAULT_SIZES
): Promise<void> {
	for (let i = 0; i < docs.length; i += sizes.bulkChunk) {
		const res = await req('POST', `/${encodeURIComponent(db)}/_bulk_docs`, {
			docs: docs.slice(i, i + sizes.bulkChunk)
		});
		if (res.status !== 201) throw httpError(`_bulk_docs to "${db}" failed`, res);
		assertBulkWriteResults(db, res.data as BulkWriteResult[], { allowConflicts: false });
	}
}

async function listDbs(req: CouchReq): Promise<string[]> {
	const res = await req('GET', '/_all_dbs');
	if (res.status !== 200) throw httpError('Cannot list databases', res);
	return res.data as string[];
}

export async function resolveShelterDbs(shelter: string, req: CouchReq): Promise<string[]> {
	const all = (await listDbs(req)).filter((db) => SHELTER_DB_PATTERN.test(db)).sort();
	const target = resolveShelterTarget(shelter);
	if (target.all) return all;
	if (!all.includes(target.db)) {
		throw new Error(`Shelter database "${target.db}" not found. Available: ${all.join(', ')}`);
	}
	return [target.db];
}

/** Write `<dir>/<db>.json` with every doc of each db (attachments inline, owner-only: PII). */
export async function backupDatabases(
	dbs: readonly string[],
	dir: string,
	req: CouchReq,
	sizes: IoSizes = DEFAULT_SIZES
): Promise<void> {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	for (const db of dbs) {
		const docs = await fetchAllDocs(db, req, { attachments: true, sizes });
		writeFileSync(join(dir, `${db}.json`), JSON.stringify({ db, docs }), { mode: 0o600 });
		console.log(`  ✓ backup ${db}: ${docs.length} doc(s) → ${join(dir, `${db}.json`)}`);
	}
}

export type CleanupResult = {
	shelters: ShelterPlan[];
	centralOps: DocRef[];
	backupDir: string | null;
};

function formatCounts(counts: Record<string, number>): string {
	const entries = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1));
	return entries.length ? entries.map(([k, n]) => `${k}=${n}`).join(', ') : '-';
}

function printPlan(plan: ShelterPlan): void {
	const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
	console.log(`\n${plan.db}`);
	console.log(
		`  evacuees: delete ${total(plan.evacueesDeleted)} · reset→pre_registered ${total(plan.evacueesReset)} · untouched ${plan.evacueesUntouched}`
	);
	console.log(`    delete by via/status: ${formatCounts(plan.evacueesDeleted)}`);
	console.log(`    reset by via/status:  ${formatCounts(plan.evacueesReset)}`);
	console.log(`  households: delete ${plan.householdsDeleted} · update ${plan.householdsUpdated}`);
	console.log(`  docs deleted by type: ${formatCounts(plan.deletedByType)}`);
}

export async function runCleanup(
	args: CliArgs,
	deps: {
		req?: CouchReq;
		couchUrl?: string;
		now?: string;
		displayUrl?: string;
		sizes?: IoSizes;
	} = {}
): Promise<CleanupResult> {
	const req = deps.req ?? couchReq;
	const sizes = deps.sizes ?? DEFAULT_SIZES;
	const couchUrl = targetCouchUrl(args.apply, deps.couchUrl);
	const now = deps.now ?? new Date().toISOString();
	if (args.apply) assertHostConfirmed(couchUrl, args.confirmHost);

	console.log(
		`\nProd-readiness cleanup → ${deps.displayUrl ?? displayCouchUrl()} — ${args.apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`
	);
	console.log(
		`Categories: ${args.categories.join(', ')} · keep channels: ${args.keepChannels.join(', ')}`
	);

	const shelterDbs = await resolveShelterDbs(args.shelter, req);
	if (args.apply) assertExpectedShelters(couchUrl, args.expectShelters, shelterDbs.length);
	const options: CleanupOptions = {
		categories: args.categories,
		keepChannels: args.keepChannels,
		now
	};
	const shelters: ShelterPlan[] = [];
	for (const db of shelterDbs) {
		const plan = planShelterCleanup(db, await fetchAllDocs(db, req, { sizes }), options);
		printPlan(plan);
		shelters.push(plan);
	}

	const hasCentralOps = (await listDbs(req)).includes(CENTRAL_OPS_DB);
	const centralOps =
		hasCentralOps && args.shelter === 'all'
			? planCentralOpsCleanup(await fetchAllDocs(CENTRAL_OPS_DB, req, { sizes }), args.categories)
			: [];
	const centralCounts: Record<string, number> = {};
	for (const ref of centralOps) bump(centralCounts, typeOfId(ref.id));
	console.log(
		`\n${CENTRAL_OPS_DB}: ${args.shelter === 'all' ? `delete ${formatCounts(centralCounts)}` : 'skipped (only with --shelter=all)'}`
	);

	const touched = [
		...shelters.filter((p) => p.updates.length || p.deletes.length).map((p) => p.db),
		...(centralOps.length ? [CENTRAL_OPS_DB] : [])
	];
	if (!args.apply || touched.length === 0) {
		console.log(
			touched.length === 0
				? '\nNothing to do.\n'
				: `\nDry run — ${touched.length} database(s) would change. Re-run with --apply.\n`
		);
		return { shelters, centralOps, backupDir: null };
	}

	const host = new URL(couchUrl).hostname;
	const backupDir = resolve(
		args.backupDir ?? join('backups', 'prod-cleanup', `${host}-${now.replace(/[:.]/g, '-')}`)
	);
	console.log(`\nBackup → ${backupDir}`);
	await backupDatabases(touched, backupDir, req, sizes);

	console.log('\nWriting…');
	for (const plan of shelters) {
		if (plan.updates.length) await bulkWrite(plan.db, plan.updates, req, sizes);
		const tombstones = plan.deletes.map((d) => ({ _id: d.id, _rev: d.rev, _deleted: true }));
		if (tombstones.length) await bulkWrite(plan.db, tombstones, req, sizes);
		if (plan.updates.length || tombstones.length) {
			console.log(`  ✓ ${plan.db}: updated ${plan.updates.length}, deleted ${tombstones.length}`);
		}
	}
	if (centralOps.length) {
		await bulkWrite(
			CENTRAL_OPS_DB,
			centralOps.map((d) => ({ _id: d.id, _rev: d.rev, _deleted: true })),
			req,
			sizes
		);
		console.log(`  ✓ ${CENTRAL_OPS_DB}: deleted ${centralOps.length}`);
	}
	console.log(`\nDone. Re-run without --apply to confirm nothing is left. Backup: ${backupDir}\n`);
	return { shelters, centralOps, backupDir };
}

/**
 * Put every backed-up doc back whose current revision differs from the backup (deleted or
 * changed since). Docs created after the backup are left alone.
 */
export async function runRestore(
	args: CliArgs,
	deps: { req?: CouchReq; couchUrl?: string; sizes?: IoSizes } = {}
): Promise<Record<string, number>> {
	const req = deps.req ?? couchReq;
	const sizes = deps.sizes ?? DEFAULT_SIZES;
	if (args.apply) assertHostConfirmed(targetCouchUrl(true, deps.couchUrl), args.confirmHost);
	const dir = resolve(args.restore!);
	if (!existsSync(dir)) throw new Error(`Backup directory not found: ${dir}`);
	const restored: Record<string, number> = {};
	for (const file of readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.sort()) {
		const { db, docs } = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
			db: string;
			docs: CouchDoc[];
		};
		const candidates = docs.filter((d) => !d._id.startsWith('_'));
		const current = new Map<string, string | null>();
		for (let i = 0; i < candidates.length; i += sizes.bulkChunk) {
			const keys = candidates.slice(i, i + sizes.bulkChunk).map((d) => d._id);
			const res = await req('POST', `/${encodeURIComponent(db)}/_all_docs`, { keys });
			if (res.status !== 200) throw httpError(`Cannot read "${db}"`, res);
			const rows = (
				res.data as { rows: Array<{ key: string; value?: { rev: string; deleted?: boolean } }> }
			).rows;
			// A deleted doc is recreated without `_rev` — writing on the tombstone rev conflicts.
			for (const row of rows) {
				current.set(row.key, row.value && !row.value.deleted ? row.value.rev : null);
			}
		}
		const writes = candidates
			.filter((d) => current.get(d._id) !== d._rev)
			.map((d) => {
				const body: CouchDoc = { ...d };
				const rev = current.get(d._id);
				if (rev) body._rev = rev;
				else delete body._rev;
				return body;
			});
		restored[db] = writes.length;
		console.log(`${db}: ${writes.length} doc(s) to restore`);
		if (args.apply && writes.length) await bulkWrite(db, writes, req, sizes);
	}
	console.log(args.apply ? '\nRestore done.\n' : '\nDry run — re-run with --apply to restore.\n');
	return restored;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const args = parseCliArgs(argv);
	if (args.help) {
		console.log(`
Usage (from frontend/):
  pnpm migrate:prod-cleanup [--shelter=SH001|all] [--only=${CATEGORIES.join(',')}]
                            [--keep-channels=web,api] [--backup-dir=<dir>]
                            [--apply [--confirm-host=<host> --expect-shelters=<n>]]
  pnpm migrate:prod-cleanup --restore=<backup-dir> [--apply [--confirm-host=<host>]]

Dry-run by default. --apply needs COUCHDB_ADMIN_URL set explicitly and backs up every touched
database (owner-only files) before writing. Off localhost, --apply also needs --confirm-host and
--expect-shelters (the shelter count from the dry-run).
Runbook: scripts/prod-readiness-cleanup.md
`);
		return;
	}
	if (args.restore) await runRestore(args);
	else await runCleanup(args);
}

if (process.argv[1]?.endsWith('prod-readiness-cleanup.ts')) {
	main().catch((err: unknown) => {
		console.error('\n✗ Prod-readiness cleanup failed:', err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
