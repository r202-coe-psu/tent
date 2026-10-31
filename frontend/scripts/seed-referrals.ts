#!/usr/bin/env tsx
/**
 * Referral volume seed for the #552 paging acceptance run.
 *
 * Usage: pnpm seed:referrals [SHELTER_CODE] [--count N] [--reset] [--delete]
 *   SHELTER_CODE   default SH001 — the shelter the list page is opened as
 *   --count N      how many referrals to write (default 500)
 *   --reset        delete this script's docs first, then write --count again
 *   --delete       delete this script's docs and stop
 *
 * Rows split evenly between the outgoing tab (`shelter_code` = this shelter) and the
 * incoming tab (`to_shelter_code` = this shelter), and cycle through every status and
 * referral type so the tab and status filters have something to show at each setting.
 *
 * Referrals live in the shared `central_ops` database (the back-office BFF reads them from
 * there, not from the shelter DB); evacuee names are read from the shelter DB to refer to.
 *
 * Ids are `referral:perf-<SHELTER>-<n>`, so --delete removes exactly what this wrote and
 * leaves real referrals alone. Every doc is validated against `referralReadSchema` before
 * it is written.
 *
 * LOCAL DEV ONLY — refuses a non-local COUCHDB_ADMIN_URL host.
 */
import {
	referralReadSchema,
	type Referral,
	type ReferralStatus,
	type ReferralType
} from '$lib/features/referrals/domain/referral.schema';
import { assertLocalCouch, bulkDocsBatched, couchReq, displayCouchUrl } from './seed/couch';

const REFERRAL_DB = 'central_ops';
const DEFAULT_SHELTER = 'SH001';
const DEFAULT_COUNT = 500;
const FALLBACK_PEERS = ['SH002', 'SH003', 'SH004'];
const STATUSES: ReferralStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'closed'];
const TYPES: ReferralType[] = ['capacity', 'resource', 'medical-emergency'];
const ORGS = [
	{ name: 'โรงพยาบาลหาดใหญ่', kind: 'hospital' as const, contact: '074-273-100' },
	{ name: 'โรงพยาบาลสงขลานครินทร์', kind: 'hospital' as const, contact: '074-455-000' },
	{ name: 'สำนักงานพัฒนาสังคมฯ จังหวัดสงขลา', kind: 'social_services' as const },
	{ name: 'มูลนิธิมิตรภาพสามัคคี', kind: 'other' as const }
];
const SEED_PREFIX = 'referral:perf-';
const SEEDED_BY = 'seed-referrals';

type EvacueeRef = { id: string; first_name: string; last_name: string; gender?: string };

function shelterDbName(shelterCode: string): string {
	return `shelter_${shelterCode.toLowerCase()}`;
}

function seedIdPrefix(shelterCode: string): string {
	return `${SEED_PREFIX}${shelterCode.toLowerCase()}-`;
}

function timelineFor(status: ReferralStatus, at: string, by: string) {
	const sent = { sent: { at, by } };
	switch (status) {
		case 'draft':
			return {};
		case 'sent':
			return sent;
		case 'accepted':
		case 'rejected':
			return { ...sent, responded: { at, by } };
		case 'closed':
			return { ...sent, responded: { at, by }, closed: { at, by } };
	}
}

export function buildReferralDocs(opts: {
	count: number;
	shelterCode: string;
	peerShelterCodes: string[];
	evacuees: EvacueeRef[];
	baseAt: Date;
}): Referral[] {
	const { count, shelterCode, peerShelterCodes, evacuees, baseAt } = opts;
	const peers = peerShelterCodes.length > 0 ? peerShelterCodes : FALLBACK_PEERS;
	const idPrefix = seedIdPrefix(shelterCode);
	const width = String(count).length;
	const docs: Referral[] = [];

	for (let i = 0; i < count; i += 1) {
		const incoming = i % 2 === 1;
		const status = STATUSES[i % STATUSES.length];
		const referralType = TYPES[i % TYPES.length];
		const peer = peers[i % peers.length];
		const evacuee = evacuees[i % evacuees.length];
		const org = ORGS[i % ORGS.length];
		const at = new Date(baseAt.getTime() - i * 60_000).toISOString();

		const base = {
			_id: `${idPrefix}${String(i + 1).padStart(width, '0')}`,
			type: 'referral' as const,
			schema_v: 1 as const,
			shelter_code: incoming ? peer : shelterCode,
			created_at: at,
			updated_at: at,
			created_by: SEEDED_BY,
			evacuee_id: evacuee.id,
			evacuee_summary: {
				first_name: evacuee.first_name,
				last_name: evacuee.last_name,
				...(evacuee.gender ? { gender: evacuee.gender } : {})
			},
			reason: `ข้อมูลทดสอบปริมาณ #552 รายการที่ ${i + 1} (${incoming ? 'ขาเข้า' : 'ขาออก'})`,
			urgency: i % 7 === 0 ? ('urgent' as const) : ('normal' as const),
			status,
			timeline: timelineFor(status, at, SEEDED_BY)
		};

		if (referralType === 'capacity') {
			docs.push({
				...base,
				referral_type: 'capacity',
				to_shelter_code: incoming ? shelterCode : peer
			});
			continue;
		}

		docs.push({
			...base,
			referral_type: referralType,
			...(incoming ? { to_shelter_code: shelterCode } : {}),
			to_org: org
		});
	}

	return docs;
}

async function readEvacuees(db: string): Promise<EvacueeRef[]> {
	const { status, data } = await couchReq('POST', `/${db}/_find`, {
		selector: { type: 'evacuee' },
		fields: ['_id', 'first_name', 'last_name', 'gender'],
		limit: 200
	});
	if (status !== 200) throw new Error(`Cannot read evacuees from ${db} (HTTP ${status})`);
	const docs = (data as { docs: Record<string, unknown>[] }).docs ?? [];
	const refs = docs.flatMap((doc) => {
		const id = typeof doc._id === 'string' ? doc._id : null;
		const first = typeof doc.first_name === 'string' ? doc.first_name : null;
		if (!id || !first) return [];
		return [
			{
				id,
				first_name: first,
				last_name: typeof doc.last_name === 'string' ? doc.last_name : '',
				...(typeof doc.gender === 'string' ? { gender: doc.gender } : {})
			}
		];
	});
	if (refs.length === 0) {
		throw new Error(`No evacuee in ${db} to refer — run \`pnpm seed\` first`);
	}
	return refs;
}

async function readPeerShelterCodes(shelterCode: string): Promise<string[]> {
	const { status, data } = await couchReq('POST', '/registry/_find', {
		selector: { type: 'shelter' },
		fields: ['code'],
		limit: 50
	});
	if (status !== 200) return FALLBACK_PEERS;
	const codes = ((data as { docs: { code?: string }[] }).docs ?? [])
		.map((doc) => doc.code)
		.filter((code): code is string => Boolean(code) && code !== shelterCode);
	return codes.length > 0 ? codes : FALLBACK_PEERS;
}

async function deleteSeeded(db: string, shelterCode: string): Promise<number> {
	const prefix = seedIdPrefix(shelterCode);
	const { status, data } = await couchReq(
		'GET',
		`/${db}/_all_docs?startkey=${encodeURIComponent(JSON.stringify(prefix))}` +
			`&endkey=${encodeURIComponent(JSON.stringify(`${prefix}￰`))}`
	);
	if (status !== 200) throw new Error(`Cannot list seeded referrals in ${db} (HTTP ${status})`);
	const rows = (data as { rows: { id: string; value: { rev: string } }[] }).rows ?? [];
	if (rows.length === 0) return 0;
	await bulkDocsBatched(
		db,
		rows.map((row) => ({ _id: row.id, _rev: row.value.rev, _deleted: true }))
	);
	return rows.length;
}

function summarize(docs: Referral[], shelterCode: string): string {
	const tally = new Map<string, number>();
	for (const doc of docs) {
		const direction = doc.shelter_code === shelterCode ? 'ขาออก' : 'ขาเข้า';
		for (const key of [direction, `สถานะ ${doc.status}`, `ชนิด ${doc.referral_type}`]) {
			tally.set(key, (tally.get(key) ?? 0) + 1);
		}
	}
	return [...tally.entries()].map(([key, n]) => `  ${key.padEnd(22)} ${n}`).join('\n');
}

function parseCount(args: string[]): number {
	const inline = args.find((a) => a.startsWith('--count='));
	const raw = inline ? inline.split('=')[1] : args[args.indexOf('--count') + 1];
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) {
		throw new Error(`--count must be a positive integer (got "${raw ?? ''}")`);
	}
	return n;
}

export async function main(argv: string[] = process.argv): Promise<void> {
	const args = argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		console.log(
			'Usage: pnpm seed:referrals [SHELTER_CODE] [--count N] [--reset] [--delete]\n' +
				'  --count N   rows to write (default 500)\n' +
				'  --reset     delete this script’s rows first, then write them again\n' +
				'  --delete    delete this script’s rows and stop'
		);
		return;
	}

	assertLocalCouch();

	const shelterCode = (args.find((a) => !a.startsWith('--')) ?? DEFAULT_SHELTER).toUpperCase();
	const evacueeDb = shelterDbName(shelterCode);
	const wantsDelete = args.includes('--delete');
	const wantsReset = args.includes('--reset');
	const count = args.some((a) => a.startsWith('--count')) ? parseCount(args) : DEFAULT_COUNT;

	console.log(`CouchDB: ${displayCouchUrl()}`);
	console.log(
		`Shelter: ${shelterCode} — referrals in ${REFERRAL_DB}, evacuees from ${evacueeDb}\n`
	);

	if (wantsDelete || wantsReset) {
		const removed = await deleteSeeded(REFERRAL_DB, shelterCode);
		console.log(`ลบรายการที่ seed ไว้ ${removed} รายการ`);
		if (wantsDelete) return;
	}

	const [evacuees, peers] = await Promise.all([
		readEvacuees(evacueeDb),
		readPeerShelterCodes(shelterCode)
	]);
	const docs = buildReferralDocs({
		count,
		shelterCode,
		peerShelterCodes: peers,
		evacuees,
		baseAt: new Date()
	});

	for (const doc of docs) {
		const parsed = referralReadSchema.safeParse(doc);
		if (!parsed.success) {
			throw new Error(
				`Generated referral ${doc._id} does not match referralReadSchema: ` +
					JSON.stringify(parsed.error.issues[0])
			);
		}
	}

	await bulkDocsBatched(REFERRAL_DB, docs);

	console.log(`เขียน referral ${docs.length} รายการ อ้างอิงผู้ประสบภัย ${evacuees.length} คน`);
	console.log(`ศูนย์ปลายทาง/ต้นทางฝั่งตรงข้าม: ${peers.join(', ')}\n`);
	console.log(summarize(docs, shelterCode));
}

if (process.argv[1]?.endsWith('seed-referrals.ts')) {
	main().catch((e: unknown) => {
		console.error('\nReferral seed failed:', e);
		process.exit(1);
	});
}
