/**
 * Target selection + fixture contract for the public-plane E2E suites.
 *
 * One suite, three targets:
 *  - **local** (no `E2E_BASE_URL`): each suite creates its data through the staff UI,
 *    then tears it down in afterAll (needs `COUCHDB_ADMIN_URL`).
 *  - **remote, read-only** (`E2E_BASE_URL` set, `ALLOW_REMOTE_WRITES` unset — production,
 *    and staging before fixtures + janitor are ready): setup, teardown and any test
 *    that writes are skipped; assertions run against a dedicated E2E fixture
 *    provisioned once through the staff UI, whose values come from env.
 *  - **remote, writable** (`E2E_BASE_URL` **and** `ALLOW_REMOTE_WRITES=true` —
 *    staging only, set by `Jenkinsfile.e2e-staging`): `@critical` suites create their
 *    own `E2E …` shelter through the staff UI against the real remote stack and tear
 *    it down the same way as local, via `CAN_WRITE` (needs `COUCHDB_ADMIN_URL` for
 *    that remote target too). Never set this for `playwright.prod.config.ts`.
 *
 * Fixture convention (provision it with exactly these shapes — fictitious names only):
 *
 * Search fixture — one shelter `E2E_SEARCH_SHELTER_NAME` with 6 evacuees, every first
 * name starting with `E2E_SEARCH_PREFIX`, last name `ทดสอบระบบ`:
 *   household 1: `<prefix>หัวหน้า` (ชาย, phone `E2E_SEARCH_PHONE`,
 *                national ID `E2E_SEARCH_NATIONAL_ID`),
 *                `<prefix>สมาชิกหนึ่ง` (หญิง), `<prefix>สมาชิกสอง` (ชาย)
 *   household 2: `<prefix>เดี่ยว` (หญิง, passport `E2E_SEARCH_PASSPORT`)
 *   household 3: `<prefix>คู่หนึ่ง` (ชาย), `<prefix>คู่สอง` (หญิง)
 *
 * ID numbers must be fictitious: a 13-digit national ID starting with `0` (real Thai
 * IDs start with 1–8, so it can never belong to anyone) and a passport of two letters
 * plus 7 digits.
 *
 * Shelters fixture — two shelters whose names start with `E2E_SHELTERS_MARKER`,
 * both in จ.สงขลา อ.หาดใหญ่:
 *   `<marker> บ้านพี่เลี้ยงคอหงส์` — host house, ต.คอหงส์, 7.01, 100.498
 *   `<marker> ศูนย์อพยพบ้านพรุ`   — evacuation centre, ต.บ้านพรุ, 6.95, 100.47
 * Set both to `closed` after provisioning so the public does not treat them as real
 * destinations — the filters under test do not depend on status.
 *
 * Remote env (all required when `E2E_BASE_URL` is set): `E2E_SEARCH_SHELTER_NAME`,
 * `E2E_SEARCH_PREFIX`, `E2E_SEARCH_PHONE`, `E2E_SEARCH_NATIONAL_ID`,
 * `E2E_SEARCH_PASSPORT`, `E2E_SHELTERS_MARKER`.
 */
import process from 'node:process';
import { test } from '@playwright/test';
import type { MemberForm, ShelterForm } from './staff-ui';

/** True for any remote target (staging or production) — fixture values must come from env. */
export const IS_REMOTE = Boolean(process.env.E2E_BASE_URL);

/**
 * Explicit opt-in for a remote target to accept live writes — set only by
 * `Jenkinsfile.e2e-staging` (never `Jenkinsfile.prod`). On its own this flag means
 * nothing locally; it only relaxes the read-only gate below when `IS_REMOTE` is true.
 */
export const ALLOW_REMOTE_WRITES = Boolean(process.env.ALLOW_REMOTE_WRITES);

/**
 * True when this run may write: always true locally, true on a remote target only
 * when it explicitly opted in. `@critical` suites gate on `!CAN_WRITE` instead of
 * `IS_REMOTE` so the same suite runs its real writes locally AND on a writable
 * staging run, while staying read-only on production (or staging before it opts in).
 */
export const CAN_WRITE = !IS_REMOTE || ALLOW_REMOTE_WRITES;

/**
 * Origin of the app under test — the running config's `baseURL` (local preview
 * :4173, or `E2E_BASE_URL` in the remote configs), so helpers and pages always agree.
 * Call inside a test or hook.
 */
export function appBaseUrl(): string {
	const baseURL = test.info().project.use.baseURL;
	if (!baseURL) throw new Error('Playwright baseURL is not configured');
	return baseURL.replace(/\/$/, '');
}

export const READ_ONLY_REASON =
	'remote target is read-only (E2E_BASE_URL is set and ALLOW_REMOTE_WRITES is not)';

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required when E2E_BASE_URL is set (see e2e/helpers/e2e-env.ts)`);
	}
	return value;
}

/** Unique per local run so leftovers from other runs never match. */
const RUN_ID = Date.now().toString(36);

export const FIXTURE_LAST_NAME = 'ทดสอบระบบ';
export const FIXTURE_LAST_NAME_MASKED = 'ทด****บบ';

export interface SearchFixture {
	shelterName: string;
	prefix: string;
	phone: string;
	nationalId: string;
	passport: string;
	head: string;
	member1: string;
	member2: string;
	solo: string;
	households: { houseNo: string; members: MemberForm[] }[];
	total: number;
}

export function searchFixture(): SearchFixture {
	const prefix = IS_REMOTE ? requireEnv('E2E_SEARCH_PREFIX') : `ทดสอบ${RUN_ID}`;
	const phone = IS_REMOTE ? requireEnv('E2E_SEARCH_PHONE') : `08${String(Date.now()).slice(-8)}`;
	// Local: fictitious and unique per run — see the ID rule in the file comment.
	const nationalId = IS_REMOTE
		? requireEnv('E2E_SEARCH_NATIONAL_ID')
		: `0${String(Date.now()).slice(-12)}`;
	const passport = IS_REMOTE
		? requireEnv('E2E_SEARCH_PASSPORT')
		: `ZZ${String(Date.now()).slice(-7)}`;
	const shelterName = IS_REMOTE
		? requireEnv('E2E_SEARCH_SHELTER_NAME')
		: `E2E ศูนย์ทดสอบค้นหา ${RUN_ID}`;
	const person = (
		firstName: string,
		gender: MemberForm['gender'],
		extra: Pick<MemberForm, 'phone' | 'idCard'> = {}
	): MemberForm => ({ firstName, lastName: FIXTURE_LAST_NAME, gender, ...extra });
	const head = `${prefix}หัวหน้า`;
	const member1 = `${prefix}สมาชิกหนึ่ง`;
	const member2 = `${prefix}สมาชิกสอง`;
	const solo = `${prefix}เดี่ยว`;
	const households = [
		{
			houseNo: '11/1',
			members: [
				person(head, 'ชาย', { phone, idCard: { type: 'national_id', number: nationalId } }),
				person(member1, 'หญิง'),
				person(member2, 'ชาย')
			]
		},
		{
			houseNo: '11/2',
			members: [person(solo, 'หญิง', { idCard: { type: 'passport', number: passport } })]
		},
		{
			houseNo: '11/3',
			members: [person(`${prefix}คู่หนึ่ง`, 'ชาย'), person(`${prefix}คู่สอง`, 'หญิง')]
		}
	];
	return {
		shelterName,
		prefix,
		phone,
		nationalId,
		passport,
		head,
		member1,
		member2,
		solo,
		households,
		total: households.reduce((n, h) => n + h.members.length, 0)
	};
}

export interface SheltersFixture {
	marker: string;
	hostNear: ShelterForm;
	evacFar: ShelterForm;
}

export function sheltersFixture(): SheltersFixture {
	const marker = IS_REMOTE ? requireEnv('E2E_SHELTERS_MARKER') : `E2Eกรอง${RUN_ID}`;
	return {
		marker,
		hostNear: {
			name: `${marker} บ้านพี่เลี้ยงคอหงส์`,
			siteKind: 'host_house',
			lat: 7.01,
			lng: 100.498,
			subdistrict: 'คอหงส์',
			capacity: 10
		},
		evacFar: {
			name: `${marker} ศูนย์อพยพบ้านพรุ`,
			siteKind: 'evacuation_center',
			lat: 6.95,
			lng: 100.47,
			subdistrict: 'บ้านพรุ',
			capacity: 200
		}
	};
}

/** Local-only run id for data a suite creates itself. */
export const LOCAL_RUN_ID = RUN_ID;
