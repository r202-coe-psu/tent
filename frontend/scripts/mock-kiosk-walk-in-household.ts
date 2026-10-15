/**
 * Mock three kiosk walk-ins from one house, for testing the household merge (CR-149 §9.4).
 *
 * The walk-ins go through the real kiosk API (`POST /api/v1/kiosk/register`, card source), so
 * the first one creates the household and the next two join it the way a kiosk would. After
 * that, a physical walk-in whose card has the same house number + หมู่ + ตำบล + อำเภอ + จังหวัด
 * (and no conflicting road) should join the same household.
 *
 *   seed    register the three walk-ins (removes the household from a previous run first)
 *   status  print the household at the address and every member in it
 *   clean   delete the mock walk-ins and their household; `--all` also deletes every real
 *           kiosk walk-in at the same house number (and its household), so that card can
 *           register again
 *
 * Usage (from frontend/, dev server running, walk-in flag on for the device's shelter):
 *   pnpm exec tsx --tsconfig .svelte-kit/tsconfig.json scripts/mock-kiosk-walk-in-household.ts seed
 *
 * Options (seed):
 *   --village-no N   หมู่ on the mock cards, default 1; `--village-no -` for none — it must match
 *                    the card you test with
 *   --road NAME      ถนน on the mock cards, default วัดโพธิ์-บางใหญ่; `--road -` for none. Roads are
 *                    compared only when both cards have one, so a different spelling on the chip
 *                    (e.g. วัดโพธิ์–บางใหญ่ with another dash) splits the household — use
 *                    `--road -` if unsure
 *
 * Device credentials: KIOSK_DEVICE_ID / KIOSK_DEVICE_SECRET / TENT_BASE_URL, falling back to
 * DEVICE_ID / DEVICE_SECRET / TENT_BASE_URL in kiosk/.env.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { bulkDocs, couchReq } from './seed/couch';

// ─── Args / env ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
function option(name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

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

const roadOption = option('--road');
const villageOption = option('--village-no');
const ADDRESS = {
	address_no: '176/235',
	village_no: villageOption === '-' ? null : (villageOption ?? '1'),
	lane: null,
	road: roadOption === '-' ? null : (roadOption ?? 'วัดโพธิ์-บางใหญ่'),
	subdistrict: 'มะขามเตี้ย',
	district: 'เมืองสุราษฎร์ธานี',
	province: 'สุราษฎร์ธานี',
	postal_code: '84000'
};

/** Thai national id check digit (mod 11). */
function withCheckDigit(first12: string): string {
	const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0);
	return first12 + String((11 - (sum % 11)) % 10);
}

const LAST_NAME = 'ทดสอบมะขามเตี้ย';
const PEOPLE = [
	{ title: 'นาย', first: 'สมชาย', gender: 'male', birth: '25100315' },
	{ title: 'นาง', first: 'สมหญิง', gender: 'female', birth: '25130721' },
	{ title: 'นางสาว', first: 'สมใจ', gender: 'female', birth: '25420109' }
] as const;
/** Clearly synthetic, checksum-valid ids: 19970000000NN + check digit. */
const MOCK_CITIZEN_IDS = PEOPLE.map((_, i) =>
	withCheckDigit(`1997000000${String(i + 1).padStart(2, '0')}`)
);

function addressRaw(): string {
	const parts = [
		ADDRESS.address_no,
		ADDRESS.village_no ? `หมู่ที่ ${ADDRESS.village_no}` : '',
		ADDRESS.road ? `ถนน${ADDRESS.road}` : '',
		`ตำบล${ADDRESS.subdistrict}`,
		`อำเภอ${ADDRESS.district}`,
		`จังหวัด${ADDRESS.province}`
	];
	return parts.filter(Boolean).join(' ');
}

function card(index: number) {
	const person = PEOPLE[index]!;
	const birthYearBe = Number(person.birth.slice(0, 4));
	const birthYearCe = birthYearBe - 543;
	const fullName = `${person.title} ${person.first} ${LAST_NAME}`;
	return {
		citizen_id: MOCK_CITIZEN_IDS[index]!,
		title_th: person.title,
		first_name_th: person.first,
		last_name_th: LAST_NAME,
		full_name_th: fullName,
		title_en: '',
		first_name_en: '',
		last_name_en: '',
		full_name_en: '',
		birth_date: person.birth,
		birth_year_ce: birthYearCe,
		age: new Date().getFullYear() - birthYearCe,
		gender: person.gender,
		address_raw: addressRaw(),
		...ADDRESS,
		issuer: null,
		issue_date: null,
		expire_date: null
	};
}

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

async function getDoc(db: string, id: string): Promise<Doc | null> {
	const { status, data } = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	return status === 200 ? (data as Doc) : null;
}

/**
 * Households of the mock walk-ins and of any other kiosk walk-in at the same house number (a
 * physical card that did not join shows up as its own household), with every evacuee in them.
 */
async function mockHouseholds(db: string): Promise<{ household: Doc | null; members: Doc[] }[]> {
	const found = (
		await Promise.all([
			...MOCK_CITIZEN_IDS.map((id) => find(db, { type: 'evacuee', 'person_id.number': id })),
			find(db, {
				type: 'evacuee',
				registered_via: 'kiosk',
				'card_snapshot.address_no': ADDRESS.address_no
			})
		])
	).flat();
	const mocks = [...new Map(found.map((d) => [d._id, d])).values()];
	const householdIds = [...new Set(mocks.map((d) => d.household_id).filter(Boolean))] as string[];
	const groups = await Promise.all(
		householdIds.map(async (id) => ({
			household: await getDoc(db, id),
			members: await find(db, { type: 'evacuee', household_id: id })
		}))
	);
	const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m._id)));
	const loose = mocks.filter((m) => !grouped.has(m._id));
	return loose.length > 0 ? [...groups, { household: null, members: loose }] : groups;
}

async function deleteDocs(db: string, docs: Doc[]): Promise<void> {
	if (docs.length === 0) return;
	await bulkDocs(
		db,
		docs.map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true })),
		{ allowConflicts: false }
	);
}

/** Card images of the evacuees (a physical walk-in has one; the mocks have none). */
function imageIds(members: Doc[]): string[] {
	return members.map((m) => m.photo).filter((id): id is string => typeof id === 'string');
}

// ─── Kiosk API ─────────────────────────────────────────────────────────────────

async function register(index: number): Promise<{ status: number; data: unknown }> {
	for (;;) {
		const res = await fetch(`${BASE_URL}/api/v1/kiosk/register`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-device-id': DEVICE_ID,
				'x-device-secret': DEVICE_SECRET
			},
			body: JSON.stringify({
				source: 'smart-card',
				card: card(index),
				photo: null,
				phone: null,
				consented: true,
				consented_at: new Date().toISOString()
			})
		});
		const data = await res.json().catch(() => null);
		if (res.status !== 429) return { status: res.status, data };
		const wait = Number(res.headers.get('retry-after') ?? 60);
		console.log(`  … rate limited, waiting ${wait}s`);
		await new Promise((done) => setTimeout(done, wait * 1000));
	}
}

// ─── Commands ──────────────────────────────────────────────────────────────────

function describeAddress(): string {
	return addressRaw() + ` ${ADDRESS.postal_code}`;
}

function isMock(evacuee: Doc): boolean {
	return MOCK_CITIZEN_IDS.includes(String((evacuee.person_id as { number?: string })?.number));
}

/**
 * Delete the mock walk-ins and their household. A real walk-in at the address is deleted only
 * with `--all`; without it, a household a real walk-in joined is left alone (deleting its mock
 * head would break it) and the run stops.
 */
async function clean(includeOthers = args.includes('--all')): Promise<void> {
	const db = shelterDbName(await shelterCodeOfDevice());
	const groups = await mockHouseholds(db);
	const blocked = groups.filter(
		(g) => g.household && g.members.some(isMock) && !g.members.every(isMock)
	);
	if (!includeOthers && blocked.length > 0) {
		throw new Error(
			`household ${blocked[0]!.household!._id} has a real walk-in in it — ` +
				'run `clean --all` to delete it too'
		);
	}
	const targets = includeOthers ? groups : groups.filter((g) => g.members.every(isMock));
	const members = targets.flatMap((g) => g.members);
	const households = targets.map((g) => g.household).filter((h): h is Doc => h !== null);
	const images = (await Promise.all(imageIds(members).map((id) => getDoc(db, id)))).filter(
		(d): d is Doc => d !== null
	);
	for (const m of members) {
		console.log(
			`  - ${m._id}  ${m.first_name} ${m.last_name}${isMock(m) ? '' : '  (real walk-in)'}`
		);
	}
	await deleteDocs(db, [...members, ...households, ...images]);
	console.log(
		`✓ deleted ${members.length} evacuee(s), ${households.length} household(s), ${images.length} image(s) from ${db}`
	);
	const kept = groups.flatMap((g) => g.members).filter((m) => !members.includes(m));
	for (const m of kept) {
		console.log(
			`  kept real walk-in ${m._id}  ${m.first_name} ${m.last_name} (use --all to delete)`
		);
	}
}

async function status(): Promise<void> {
	const shelterCode = await shelterCodeOfDevice();
	const db = shelterDbName(shelterCode);
	const groups = await mockHouseholds(db);
	if (groups.length === 0) {
		console.log(`No mock walk-ins in ${db} — run seed first`);
		return;
	}
	for (const { household, members } of groups) {
		console.log(
			household
				? `household ${household._id}  status=${household.status}  label=${household.label}`
				: 'no household'
		);
		for (const m of members) {
			const head = household?.head_evacuee_id === m._id ? '  ← head' : '';
			const stay = (m.current_stay as { status?: string } | undefined)?.status;
			const road = (m.card_snapshot as { road?: string | null } | undefined)?.road ?? '-';
			console.log(`  ${m._id}  ${m.first_name} ${m.last_name}  ${stay}  road=${road}${head}`);
		}
	}
	const mockGroups = groups.filter((g) => g.members.some(isMock)).length;
	if (mockGroups > 1) console.log(`\n✗ the mock walk-ins are split over ${mockGroups} households`);
}

async function seed(): Promise<void> {
	if (!DEVICE_SECRET) throw new Error('No kiosk device secret (KIOSK_DEVICE_SECRET or kiosk/.env)');
	const shelterCode = await shelterCodeOfDevice();
	console.log(`Kiosk ${DEVICE_ID} @ ${BASE_URL} (${shelterCode})`);
	console.log(`Address: ${describeAddress()}\n`);

	const existing = (await mockHouseholds(shelterDbName(shelterCode))).flatMap((g) => g.members);
	if (existing.some(isMock)) {
		console.log('Removing the previous run:');
		await clean(false);
		console.log('');
	}
	const real = existing.filter((m) => !isMock(m));
	if (real.length > 0) {
		console.log('⚠ real walk-ins already at this house number — their card cannot register again');
		console.log('  until they are deleted (`clean --all`, then seed again):');
		for (const m of real) console.log(`    ${m._id}  ${m.first_name} ${m.last_name}`);
		console.log('');
	}

	for (let i = 0; i < PEOPLE.length; i++) {
		const { status: code, data } = await register(i);
		const person = `${PEOPLE[i]!.first} ${LAST_NAME} (${MOCK_CITIZEN_IDS[i]})`;
		if (code !== 200) {
			const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
			console.error(`✗ ${person}: HTTP ${code} ${error?.code ?? ''} ${error?.message ?? ''}`);
			if (error?.code === 'KIOSK_REGISTRATION_DISABLED') {
				console.error('  Turn on walk-in registration for this shelter in the back office.');
			}
			process.exit(1);
		}
		console.log(`✓ ${person} → ${(data as { evacuee_id?: string }).evacuee_id}`);
	}

	console.log('');
	await status();
	console.log(
		'\nNow walk in at the kiosk with a card from the same address, then run `status` to see' +
			'\nwhether it joined. `clean` removes the mocks; `clean --all` also removes the real walk-in.'
	);
}

const commands: Record<string, () => Promise<void>> = { seed, status, clean };
const run = commands[command ?? ''];
if (!run) {
	console.error(
		'usage: mock-kiosk-walk-in-household.ts <seed|status|clean> [--village-no N|-] [--road NAME|-]'
	);
	process.exit(2);
}
run().catch((error) => {
	console.error('✗', error instanceof Error ? error.message : error);
	process.exit(1);
});
