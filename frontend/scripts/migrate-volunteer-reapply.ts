/**
 * Consolidate legacy volunteer duplicates created by public re-application.
 *
 *   pnpm migrate:volunteer-reapply                 # dry-run
 *   pnpm migrate:volunteer-reapply --write --confirm
 *
 * SHELTER_DB selects one shelter database. The script never deletes a duplicate;
 * it relinks safe application/assignment documents and marks the old profile as
 * quarantined with `merged_into`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type VerificationRecord = { status?: string; [key: string]: unknown };
type CouchDoc = {
	_id: string;
	_rev?: string;
	type?: string;
	identity_verification?: VerificationRecord;
	identity_verified?: boolean;
	skill_verifications?: Record<string, VerificationRecord>;
	skills?: unknown[];
	volunteer_id?: string;
	[key: string]: unknown;
};
type Decision = 'auto_merge' | 'manual_review' | 'no_action';

function loadEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf-8')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#') && line.includes('='))
			.map((line) => {
				const separator = line.indexOf('=');
				return [
					line.slice(0, separator).trim(),
					line
						.slice(separator + 1)
						.trim()
						.replace(/^['"]|['"]$/g, '')
				];
			})
	);
}

function parseCouchUrl(raw: string): { baseUrl: string; authHeader: string } {
	const url = new URL(raw);
	const authHeader =
		url.username || url.password
			? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
			: '';
	url.username = '';
	url.password = '';
	return { baseUrl: url.toString().replace(/\/$/, ''), authHeader };
}

const env = loadEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;
if (!rawCouchUrl) throw new Error('COUCHDB_ADMIN_URL is not set in frontend/.env');
const { baseUrl, authHeader } = parseCouchUrl(rawCouchUrl);
const dbName = process.env.SHELTER_DB ?? env.SHELTER_DB ?? 'shelter_sh001';
const dryRun = !process.argv.includes('--write');
if (!dryRun && !process.argv.includes('--confirm')) throw new Error('--write requires --confirm');

async function couchReq(method: string, path: string, body?: unknown) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authHeader) headers.Authorization = authHeader;
	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: response.status, data: await response.json().catch(() => null) };
}

function identityVerified(doc: CouchDoc): boolean {
	return doc.identity_verification?.status === 'verified' || doc.identity_verified === true;
}

function verifiedSkillCount(doc: CouchDoc): number {
	return Object.values(doc.skill_verifications ?? {}).filter((row) => row?.status === 'verified')
		.length;
}

function conflict(rows: CouchDoc[]): string[] {
	const reasons: string[] = [];
	const names = new Set(rows.map((row) => `${row.first_name ?? ''}|${row.last_name ?? ''}`));
	const ids = new Set(rows.map((row) => row.national_id_hash).filter(Boolean));
	if (names.size > 1) reasons.push('name_conflict');
	if (ids.size > 1) reasons.push('national_id_conflict');
	const skillStatuses = new Map<string, Set<string>>();
	for (const row of rows) {
		for (const [skill, record] of Object.entries(row.skill_verifications ?? {})) {
			const set = skillStatuses.get(skill) ?? new Set<string>();
			if (record?.status) set.add(record.status);
			skillStatuses.set(skill, set);
		}
	}
	for (const [skill, statuses] of skillStatuses) {
		if (statuses.has('verified') && statuses.has('rejected'))
			reasons.push(`skill_conflict:${skill}`);
	}
	return reasons;
}

function canonical(rows: CouchDoc[], counts: Map<string, number>): CouchDoc | null {
	const sorted = [...rows].sort((a, b) => {
		if (identityVerified(a) !== identityVerified(b)) return identityVerified(a) ? -1 : 1;
		if (verifiedSkillCount(a) !== verifiedSkillCount(b))
			return verifiedSkillCount(b) - verifiedSkillCount(a);
		if ((counts.get(a._id) ?? 0) !== (counts.get(b._id) ?? 0))
			return (counts.get(b._id) ?? 0) - (counts.get(a._id) ?? 0);
		return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
	});
	const first = sorted[0];
	const second = sorted[1];
	if (
		second &&
		identityVerified(first) === identityVerified(second) &&
		verifiedSkillCount(first) === verifiedSkillCount(second) &&
		(counts.get(first._id) ?? 0) === (counts.get(second._id) ?? 0) &&
		String(first.created_at ?? '') === String(second.created_at ?? '')
	)
		return null;
	return first;
}

function mergeProfile(target: CouchDoc, rows: CouchDoc[], runId: string): CouchDoc {
	const skills = new Map<string, string>();
	const verifications: Record<string, VerificationRecord> = {
		...(target.skill_verifications ?? {})
	};
	for (const row of rows) {
		for (const skill of row.skills ?? [])
			skills.set(String(skill).trim().toLowerCase(), String(skill).trim());
		for (const [skill, record] of Object.entries(row.skill_verifications ?? {})) {
			const current = verifications[skill];
			if (!current || current.status !== 'verified') verifications[skill] = record;
		}
	}
	return {
		...target,
		skills: [...skills.values()],
		skill_verifications: verifications,
		updated_at: new Date().toISOString(),
		updated_by: `migration:${runId}`
	};
}

async function main() {
	const runId = `volunteer-reapply-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
	const response = await couchReq(
		'GET',
		`/${encodeURIComponent(dbName)}/_all_docs?include_docs=true`
	);
	if (response.status >= 400) throw new Error(`โหลด CouchDB ไม่สำเร็จ (${response.status})`);
	const rows = ((response.data as { rows?: Array<{ doc?: CouchDoc }> })?.rows ?? [])
		.map((row) => row.doc)
		.filter((doc): doc is CouchDoc => Boolean(doc?._id));
	const volunteers = rows.filter(
		(doc) => doc.type === 'volunteer' && doc.phone_hash && !doc.merged_into
	);
	const groups = new Map<string, CouchDoc[]>();
	for (const volunteer of volunteers) {
		const key = `${volunteer.shelter_code ?? dbName}|${volunteer.phone_hash}`;
		groups.set(key, [...(groups.get(key) ?? []), volunteer]);
	}
	const applications = rows.filter((doc) => doc.type === 'job_application');
	const assignments = rows.filter((doc) => doc.type === 'shift_assignment');
	const counts = new Map<string, number>();
	for (const doc of [...applications, ...assignments]) {
		if (doc.volunteer_id) counts.set(doc.volunteer_id, (counts.get(doc.volunteer_id) ?? 0) + 1);
	}

	const report: Array<Record<string, unknown>> = [];
	for (const [key, candidates] of groups) {
		if (candidates.length < 2) continue;
		const reasons = conflict(candidates);
		const target = canonical(candidates, counts);
		if (!target) reasons.push('canonical_tie');
		if (
			assignments.some(
				(doc) =>
					candidates.some((candidate) => candidate._id === doc.volunteer_id) &&
					Boolean(doc.check_in_at)
			)
		)
			reasons.push('checked_in_assignment');
		const decision: Decision = reasons.length ? 'manual_review' : 'auto_merge';
		const item = {
			shelter_code: String(candidates[0].shelter_code ?? dbName),
			phone_hash: `${key.split('|').at(-1)?.slice(0, 8)}…`,
			candidates: candidates.map((row) => ({
				volunteer_id: row._id,
				created_at: row.created_at,
				identity_status: identityVerified(row)
					? 'verified'
					: (row.identity_verification?.status ?? 'pending'),
				applications: counts.get(row._id) ?? 0
			})),
			canonical: target?._id ?? null,
			decision,
			conflicts: reasons
		};
		report.push(item);
		if (dryRun || decision !== 'auto_merge' || !target) continue;

		await couchReq(
			'PUT',
			`/${encodeURIComponent(dbName)}/${encodeURIComponent(target._id)}`,
			mergeProfile(target, candidates, runId)
		);
		for (const duplicate of candidates.filter((row) => row._id !== target._id)) {
			for (const doc of [...applications, ...assignments].filter(
				(row) => row.volunteer_id === duplicate._id
			)) {
				await couchReq('PUT', `/${encodeURIComponent(dbName)}/${encodeURIComponent(doc._id)}`, {
					...doc,
					volunteer_id: target._id,
					migration_run_id: runId
				});
			}
			await couchReq('PUT', `/${encodeURIComponent(dbName)}/${encodeURIComponent(duplicate._id)}`, {
				...duplicate,
				merged_into: target._id,
				merged_at: new Date().toISOString(),
				merged_by: `migration:${runId}`,
				migration_run_id: runId,
				status: 'inactive'
			});
		}
	}

	console.log(
		JSON.stringify({ dbName, mode: dryRun ? 'dry-run' : 'write', runId, groups: report }, null, 2)
	);
}

main().catch((error) => {
	console.error('Fatal:', error instanceof Error ? error.message : error);
	process.exit(1);
});
