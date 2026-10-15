/**
 * Mock a large pre-registered family and run it through the kiosk API (CR-151).
 *
 * The family is built with the same domain factories the public booking uses
 * (`planFamilyRegistration('public')` → `pre_registered`, `registered_via: 'web'`). The public
 * form caps one submission at 20 members, so a 30-person family is written the way it would
 * really arrive: a first booking of 20, then a second booking of 10 that joins the household.
 *
 *   seed   write the household + members into the kiosk device's shelter DB
 *   test   drive /api/v1/kiosk/{lookup,check-in} with the head's citizen id and assert
 *   reset  put every mock member back to `pre_registered` (re-test on the physical kiosk)
 *   clean  delete every mock doc
 *
 * Usage (from frontend/, dev server running):
 *   pnpm exec tsx --tsconfig .svelte-kit/tsconfig.json scripts/mock-kiosk-family.ts seed
 *   pnpm exec tsx --tsconfig .svelte-kit/tsconfig.json scripts/mock-kiosk-family.ts test
 *
 * Options:
 *   --size N               members, default 30
 *   --citizen-id ID        head's 13-digit id, default 1101700391647
 *   --evict-existing       seed only: delete other evacuees in the shelter already holding the
 *                          head's citizen id (otherwise lookup sees 2 matches → not_found)
 *
 * Device credentials: KIOSK_DEVICE_ID / KIOSK_DEVICE_SECRET / TENT_BASE_URL, falling back to
 * DEVICE_ID / DEVICE_SECRET / TENT_BASE_URL in kiosk/.env.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvacuee, createHousehold } from '$lib/features/people/domain/people';
import {
	blankUnifiedMember,
	planFamilyRegistration,
	type UnifiedMemberInput
} from '$lib/features/people/domain/unified-registration';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { bulkDocs, couchReq } from './seed/couch';

const MOCK_AUTHOR = 'mock-kiosk-family';
const PUBLIC_BATCH_MAX = 20;
const CHECK_IN_BATCH_MAX = 20;

// ─── Args / env ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
function option(name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
const FAMILY_SIZE = Number(option('--size') ?? 30);
const HEAD_CITIZEN_ID = option('--citizen-id') ?? '1101700391647';
const EVICT_EXISTING = args.includes('--evict-existing');

function readEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) return {};
	const env: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^([^#=]+)=(.*)$/);
		if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
	}
	return env;
}
const scannerEnv = readEnvFile(
	resolve(dirname(fileURLToPath(import.meta.url)), '../../kiosk/.env')
);
const DEVICE_ID = process.env.KIOSK_DEVICE_ID ?? scannerEnv.DEVICE_ID ?? '';
const DEVICE_SECRET = process.env.KIOSK_DEVICE_SECRET ?? scannerEnv.DEVICE_SECRET ?? '';
const BASE_URL = (
	process.env.TENT_BASE_URL ??
	scannerEnv.TENT_BASE_URL ??
	'http://localhost:5173'
).replace(/\/$/, '');

// ─── Fixture ───────────────────────────────────────────────────────────────────

/** Thai national id check digit (mod 11). */
function withCheckDigit(first12: string): string {
	const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0);
	return first12 + String((11 - (sum % 11)) % 10);
}

/** Members 2..N get deterministic, checksum-valid ids that are clearly synthetic. */
function memberCitizenId(index: number): string {
	return withCheckDigit(`19990${String(index).padStart(7, '0')}`);
}

const FIRST_NAMES = [
	'สมชาย',
	'สมหญิง',
	'วิชัย',
	'มาลี',
	'ประเสริฐ',
	'สุดา',
	'อนันต์',
	'กมลา',
	'ธีระ',
	'พรทิพย์',
	'ชัยวัฒน์',
	'อรุณี',
	'สุรชัย',
	'นภา',
	'บุญมี',
	'จันทร์เพ็ญ',
	'ไพโรจน์',
	'รัตนา',
	'เกรียงไกร',
	'ดวงใจ',
	'ศักดิ์ชัย',
	'วันเพ็ญ',
	'ปรีชา',
	'สายสุนีย์',
	'ณรงค์',
	'ลำดวน',
	'อำนาจ',
	'ทองใบ',
	'สมศักดิ์',
	'บัวผัน'
];
const FAMILY_NAME = 'ทดสอบครอบครัวใหญ่';

function buildMember(index: number): UnifiedMemberInput {
	const isHead = index === 0;
	// Mix ages: elders, adults, kids, infants — the kiosk list shows age per row.
	const age = [68, 65, 42, 40, 38, 35, 17, 14, 9, 5, 2, 0][index % 12];
	return {
		...blankUnifiedMember(),
		first_name: `${FIRST_NAMES[index % FIRST_NAMES.length]}${index >= FIRST_NAMES.length ? index : ''}`,
		last_name: FAMILY_NAME,
		gender: index % 2 === 0 ? 'male' : 'female',
		age,
		phone: isHead ? '0899990000' : null,
		religion: 'buddhist',
		person_id: {
			cardType: 'national_id',
			number: isHead ? HEAD_CITIZEN_ID : memberCitizenId(index)
		},
		emergency_contact: { name: 'ผู้ติดต่อฉุกเฉิน ทดสอบ', phone: '0811111111', relation: 'ญาติ' }
	};
}

const HOUSEHOLD = {
	housing_type: 'owned_house' as const,
	address_no: '99/9',
	village_no: '1',
	subdistrict: 'คอหงส์',
	district: 'หาดใหญ่',
	province: 'สงขลา',
	postal_code: '90110'
};

// ─── Couch helpers ─────────────────────────────────────────────────────────────

type Doc = { _id: string; _rev?: string; [key: string]: unknown };

async function shelterCodeOfDevice(): Promise<string> {
	if (!DEVICE_ID) throw new Error('No kiosk device id (KIOSK_DEVICE_ID or kiosk/.env)');
	const { status, data } = await couchReq(
		'GET',
		`/registry/${encodeURIComponent(`scanner_device:${DEVICE_ID}`)}`
	);
	const code = (data as { shelter_code?: string } | null)?.shelter_code;
	if (status !== 200 || !code) throw new Error(`Scanner device "${DEVICE_ID}" not in registry`);
	return code;
}

async function find(db: string, selector: Record<string, unknown>): Promise<Doc[]> {
	const { status, data } = await couchReq('POST', `/${db}/_find`, { selector, limit: 1000 });
	if (status !== 200) throw new Error(`_find on ${db} failed (HTTP ${status})`);
	return ((data as { docs?: Doc[] }).docs ?? []) as Doc[];
}

const findMockDocs = (db: string) => find(db, { created_by: MOCK_AUTHOR });

async function deleteDocs(db: string, docs: Doc[]): Promise<void> {
	await bulkDocs(
		db,
		docs.map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true })),
		{ allowConflicts: false }
	);
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
	const shelterCode = await shelterCodeOfDevice();
	const db = shelterDbName(shelterCode);

	const previous = await findMockDocs(db);
	if (previous.length > 0) {
		await deleteDocs(db, previous);
		console.log(`  - removed ${previous.length} docs from a previous mock run`);
	}

	const holders = await find(db, { type: 'evacuee', 'person_id.number': HEAD_CITIZEN_ID });
	if (holders.length > 0) {
		if (!EVICT_EXISTING) {
			console.error(
				`✗ ${db} already has ${holders.length} evacuee(s) with citizen id ${HEAD_CITIZEN_ID}:\n` +
					holders.map((d) => `    ${d._id} created_by=${d.created_by}`).join('\n') +
					'\n  The kiosk lookup would see 2 matches and answer not_found.' +
					'\n  Re-run with --evict-existing to delete them first.'
			);
			process.exit(1);
		}
		await deleteDocs(db, holders);
		console.log(`  - evicted ${holders.length} existing evacuee(s) holding ${HEAD_CITIZEN_ID}`);
	}

	const ctx = { shelterCode, createdBy: MOCK_AUTHOR };
	const members = Array.from({ length: FAMILY_SIZE }, (_, i) => buildMember(i));

	// Booking 1: create the household with the first 20 (public form cap).
	const first = planFamilyRegistration(
		{ members: members.slice(0, PUBLIC_BATCH_MAX), household: HOUSEHOLD },
		'public'
	);
	const household = createHousehold(first.householdInput, ctx);
	const evacuees = first.memberInputs.map((input) =>
		createEvacuee({ ...input, household_id: household._id }, ctx)
	);
	household.head_evacuee_id = evacuees[0]!._id;

	// Booking 2..n: the rest join the same household.
	for (let start = PUBLIC_BATCH_MAX; start < members.length; start += PUBLIC_BATCH_MAX) {
		const join = planFamilyRegistration(
			{
				members: members.slice(start, start + PUBLIC_BATCH_MAX),
				household: HOUSEHOLD,
				join_household_id: household._id
			},
			'public'
		);
		evacuees.push(...join.memberInputs.map((input) => createEvacuee(input, ctx)));
	}

	await bulkDocs(db, [household, ...evacuees], { allowConflicts: false });

	console.log(`✓ seeded ${evacuees.length}-member pre-registered family into ${db}`);
	console.log(`  household  ${household._id}`);
	console.log(`  head       ${evacuees[0]!._id}  citizen_id=${HEAD_CITIZEN_ID}`);
	console.log(`  device     ${DEVICE_ID} (${shelterCode})`);
}

async function reset(): Promise<void> {
	const db = shelterDbName(await shelterCodeOfDevice());
	const docs = await findMockDocs(db);
	if (docs.length === 0) throw new Error('No mock family found — run seed first');
	const ts = new Date().toISOString();
	const updated = docs.map((doc) =>
		doc.type === 'evacuee'
			? {
					...doc,
					photo: null,
					current_stay: { status: 'pre_registered', zone: null, since: ts },
					updated_at: ts
				}
			: { ...doc, status: 'pre_registered', updated_at: ts }
	);
	await bulkDocs(db, updated, { allowConflicts: false });
	console.log(`✓ reset ${docs.length} mock docs in ${db} to pre_registered`);
}

async function clean(): Promise<void> {
	const db = shelterDbName(await shelterCodeOfDevice());
	const docs = await findMockDocs(db);
	await deleteDocs(db, docs);
	console.log(`✓ deleted ${docs.length} mock docs from ${db}`);
}

// ─── Kiosk API test ────────────────────────────────────────────────────────────

type Summary = {
	evacuee_id: string;
	last_name: string;
	status: string;
	is_primary: boolean;
	selectable: boolean;
};
type MemberResult = {
	evacuee_id: string;
	status: string;
	qr_payload?: string;
	label?: { name: string };
};
type KioskResponse = {
	kind?: string;
	primary_evacuee_id?: string;
	members?: Summary[] | MemberResult[];
} | null;

async function kiosk(
	path: string,
	body: unknown
): Promise<{ status: number; data: KioskResponse }> {
	const res = await fetch(`${BASE_URL}/api/v1/kiosk/${path}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-device-id': DEVICE_ID,
			'x-device-secret': DEVICE_SECRET
		},
		body: JSON.stringify(body)
	});
	return { status: res.status, data: await res.json().catch(() => null) };
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	if (!ok) failures += 1;
	console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? `  — ${detail}` : ''}`);
}

async function lookup(): Promise<{ primary: string; members: Summary[] }> {
	const { status, data } = await kiosk('lookup', {
		source: 'smart-card',
		citizen_id: HEAD_CITIZEN_ID
	});
	if (status !== 200 || data?.kind !== 'household') {
		throw new Error(`lookup failed: HTTP ${status} ${JSON.stringify(data)}`);
	}
	return { primary: data.primary_evacuee_id ?? '', members: (data.members ?? []) as Summary[] };
}

async function checkIn(primary: string, ids: string[]): Promise<MemberResult[]> {
	const results: MemberResult[] = [];
	for (let i = 0; i < ids.length; i += CHECK_IN_BATCH_MAX) {
		const batch = ids.slice(i, i + CHECK_IN_BATCH_MAX);
		const includesPrimary = batch.includes(primary);
		const { status, data } = await kiosk('check-in', {
			primary_evacuee_id: primary,
			evacuee_ids: batch,
			...(includesPrimary ? { source: 'smart-card', citizen_id: HEAD_CITIZEN_ID } : {})
		});
		check(
			`check-in batch ${i / CHECK_IN_BATCH_MAX + 1} (${batch.length}) → 200`,
			status === 200,
			`HTTP ${status} ${JSON.stringify(data)}`
		);
		results.push(...((data?.members ?? []) as MemberResult[]));
	}
	return results;
}

async function test(): Promise<void> {
	if (!DEVICE_SECRET) throw new Error('No kiosk device secret (KIOSK_DEVICE_SECRET or kiosk/.env)');
	const shelterCode = await shelterCodeOfDevice();
	const db = shelterDbName(shelterCode);
	console.log(`Kiosk ${DEVICE_ID} @ ${BASE_URL} (${shelterCode}), head ${HEAD_CITIZEN_ID}\n`);

	console.log('1. lookup ด้วยบัตรของผู้ติดต่อหลัก');
	const before = await lookup();
	check(
		`lists all ${FAMILY_SIZE} members`,
		before.members.length === FAMILY_SIZE,
		`got ${before.members.length}`
	);
	check(
		'exactly one primary, and it is the card owner',
		before.members.filter((m) => m.is_primary).length === 1 &&
			before.members.find((m) => m.is_primary)?.evacuee_id === before.primary
	);
	check(
		'every member pre_registered + selectable',
		before.members.every((m) => m.status === 'pre_registered' && m.selectable),
		before.members
			.filter((m) => !m.selectable)
			.map((m) => m.status)
			.join(',')
	);
	check(
		'last names masked',
		before.members.every((m) => m.last_name !== FAMILY_NAME)
	);
	if (failures > 0) {
		console.log('\nState is not fresh — run `reset` (or `seed`) first.');
		process.exit(1);
	}

	const allIds = before.members.map((m) => m.evacuee_id);

	console.log(
		`\n2. check-in ทั้ง ${FAMILY_SIZE} คนใน request เดียว (เกิน cap ${CHECK_IN_BATCH_MAX})`
	);
	const single = await kiosk('check-in', {
		primary_evacuee_id: before.primary,
		evacuee_ids: allIds
	});
	check(`rejected 400 — the kiosk UI must batch`, single.status === 400, `HTTP ${single.status}`);

	console.log(`\n3. check-in แบ่ง batch ละ ${CHECK_IN_BATCH_MAX} (เหมือน kiosk UI)`);
	const results = await checkIn(before.primary, allIds);
	check(`${FAMILY_SIZE} results`, results.length === FAMILY_SIZE, `got ${results.length}`);
	check(
		'all checked_in',
		results.every((r) => r.status === 'checked_in'),
		results
			.filter((r) => r.status !== 'checked_in')
			.map((r) => r.status)
			.join(',')
	);
	check(
		'each has qr_payload = own evacuee id + label',
		results.every((r) => r.qr_payload === r.evacuee_id && Boolean(r.label?.name))
	);
	const labels = Math.ceil(results.length / 8);
	console.log(`    (label print: ${results.length} ใบ → ${labels} รอบ ๆ ละไม่เกิน 8 ใบ)`);

	console.log('\n4. lookup ซ้ำหลังรายงานตัว');
	const after = await lookup();
	check(
		'all arriving, none selectable',
		after.members.every((m) => m.status === 'arriving' && !m.selectable)
	);

	console.log('\n5. check-in ซ้ำ (พิมพ์ label ซ้ำ)');
	const again = await checkIn(after.primary, allIds);
	check(
		'all already_checked_in with qr_payload',
		again.every((r) => r.status === 'already_checked_in' && r.qr_payload === r.evacuee_id)
	);

	console.log('\n6. CouchDB state');
	const docs = await find(db, { created_by: MOCK_AUTHOR });
	const household = docs.find((d) => d.type === 'household');
	const evacuees = docs.filter((d) => d.type === 'evacuee');
	check(
		`${FAMILY_SIZE} evacuees arriving`,
		evacuees.length === FAMILY_SIZE &&
			evacuees.every((d) => (d.current_stay as { status?: string })?.status === 'arriving')
	);
	check(
		'household status refreshed',
		household?.status !== 'pre_registered',
		`status=${household?.status}`
	);

	console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
	console.log('Run `reset` to put the family back to pre_registered for another round.');
	process.exit(failures === 0 ? 0 : 1);
}

const commands: Record<string, () => Promise<void>> = { seed, test, reset, clean };
const run = commands[command ?? ''];
if (!run) {
	console.error(
		'usage: mock-kiosk-family.ts <seed|test|reset|clean> [--size N] [--citizen-id ID] [--evict-existing]'
	);
	process.exit(2);
}
run().catch((error) => {
	console.error('✗', error instanceof Error ? error.message : error);
	process.exit(1);
});
