/**
 * What the keyed plane `/external/v1` returns: the same announcements, FAQs and needs the public
 * plane serves (one Mongo source, two doors), only active announcements, paging bounds, 404 for
 * an unknown shelter, and the M2 routes CR-154 moved to the partner plane stay gone.
 * docs/data/api-contract.md §5.1, CR-062, CR-154.
 *
 * UAT-141 (announcements reach outside consumers)
 */
import { expect, test } from '@playwright/test';
import { fastapiTarget } from '../../lib/env.ts';
import {
	callFastapi,
	fastapiIsUp,
	issueApiKey,
	revokeApiKey,
	type IssuedKey
} from '../../lib/fastapi.ts';

const RUN = Date.now().toString(36);
let key: IssuedKey;

const keyed = <T = any>(path: string) =>
	callFastapi<T>(`/external/v1${path}`, { headers: { 'X-API-Key': key.api_key } });
const publicPlane = <T = any>(path: string) =>
	callFastapi<T>(`/public/v1${path}`, {
		headers: { Authorization: `Bearer ${fastapiTarget().adminSecret}` }
	});

test.beforeAll(async () => {
	test.skip(
		!(await fastapiIsUp()),
		`FastAPI is not answering at ${fastapiTarget().base}: run \`docker compose up -d\` first`
	);
	key = await issueApiKey(`PERMTEST external content ${RUN}`);
});

test.afterAll(async () => {
	if (key) await revokeApiKey(key.id).catch(() => undefined);
});

test('announcements: only active ones, the same set the public plane shows', async () => {
	const ext = await keyed<{
		items: { id?: string; _id?: string; is_active?: boolean }[];
		total: number;
	}>('/announcements?size=100');
	const pub = await publicPlane<{ items: { id?: string; _id?: string }[]; total: number }>(
		'/announcements?size=100'
	);
	expect(ext.status).toBe(200);
	expect(pub.status).toBe(200);
	for (const item of ext.body.items) expect(item.is_active, 'active only').not.toBe(false);
	const ids = (items: { id?: string; _id?: string }[]) => items.map((i) => i.id ?? i._id).sort();
	expect(ids(ext.body.items)).toEqual(ids(pub.body.items));
	expect(ext.body.total).toBe(pub.body.total);
});

test('announcements: page and size are bounded', async () => {
	expect((await keyed('/announcements?size=101')).status).toBe(422);
	expect((await keyed('/announcements?size=0')).status).toBe(422);
	expect((await keyed('/announcements?page=0')).status).toBe(422);
	const far = await keyed<{ items: unknown[] }>('/announcements?page=9999');
	expect(far.status).toBe(200);
	expect(far.body.items).toEqual([]);
});

test('FAQ config is the one the public plane serves', async () => {
	const ext = await keyed('/config/faqs');
	const pub = await publicPlane('/config/faqs');
	expect(ext.status).toBe(200);
	expect(ext.body).toEqual(pub.body);
});

test('needs come from the same shelters the public plane lists', async () => {
	const ext = await keyed<{ items?: { shelter_code?: string }[] } & Record<string, unknown>>(
		'/needs'
	);
	expect(ext.status).toBe(200);
	const rows = (ext.body.items ?? (ext.body.needs as { shelter_code?: string }[]) ?? []) as {
		shelter_code?: string;
	}[];
	const shelters = await publicPlane<{ items?: { shelter_code?: string; id?: string }[] }>(
		'/shelters?size=100'
	);
	const known = new Set(
		(shelters.body.items ?? []).map((s) => s.shelter_code ?? s.id).filter(Boolean)
	);
	for (const row of rows) {
		if (row.shelter_code) {
			expect(known.has(row.shelter_code), `need for ${row.shelter_code} is a known shelter`).toBe(
				true
			);
		}
	}
});

test('an unknown shelter is 404, and the M2 routes removed by CR-154 stay gone', async () => {
	expect((await keyed('/shelters/PERMTEST-NONE')).status).toBe(404);
	expect((await keyed('/shelters')).status, 'M2 list moved to EXT-002').toBe(404);
	expect(
		(await keyed('/persons/shelter-residency?cid=0000000000000')).status,
		'M2 residency moved to EXT-011'
	).toBe(404);
});
