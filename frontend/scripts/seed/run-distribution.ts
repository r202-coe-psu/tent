import type { AuthorContext } from '$lib/db/model';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { assertLocalCouch, bulkDocs, couchReq, displayCouchUrl, liveRevs } from './couch';
import {
	buildBackOfficeDocs,
	buildDistributionDocs,
	DISTRIBUTION_ACTOR,
	DISTRIBUTION_ITEM_NAMES,
	DISTRIBUTION_RECIPIENTS_NEEDED,
	type DistributionCatalog,
	type DistributionCatalogItem,
	type DistributionItemKey,
	type DistributionRecipient
} from './distribution';

export type DistributionScenario = 'desk' | 'back-office';

export interface DistributionSeedOptions {
	shelterCode: string;
	/** `desk` = dispatched tickets for /onsite/distribution; `back-office` = tickets to dispatch. */
	scenario: DistributionScenario;
	/** Delete this seed's docs first, then write them again. */
	reset: boolean;
}

async function loadCatalog(): Promise<DistributionCatalog> {
	const { status, data } = await couchReq('GET', '/catalog/_all_docs?include_docs=true');
	if (status !== 200) throw new Error(`Cannot read catalog (HTTP ${status})`);
	type Row = { doc?: DistributionCatalogItem & { type?: string } };
	const byName = new Map<string, DistributionCatalogItem>();
	for (const row of (data as { rows: Row[] }).rows) {
		if (row.doc?.type === 'item_master') byName.set(row.doc.name, row.doc);
	}
	const entries = Object.entries(DISTRIBUTION_ITEM_NAMES) as [DistributionItemKey, string][];
	return Object.fromEntries(
		entries.map(([key, name]) => {
			const item = byName.get(name);
			if (!item) throw new Error(`item_master "${name}" not found — run pnpm seed:master first`);
			return [key, item];
		})
	) as DistributionCatalog;
}

/**
 * Where seeded tickets go — the name the back-office destination picker would store: the
 * shelter's first food distribution point, else its first zone (registry shelter master).
 */
async function loadDestination(shelterCode: string): Promise<string> {
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status !== 200) throw new Error(`Cannot read registry (HTTP ${status})`);
	type Named = { name?: string };
	type Row = {
		doc?: { code?: string; food_distribution_points?: Named[]; zones?: Named[] };
	};
	const shelter = (data as { rows: Row[] }).rows.find((r) => r.doc?.code === shelterCode)?.doc;
	const name = [...(shelter?.food_distribution_points ?? []), ...(shelter?.zones ?? [])].find((p) =>
		p.name?.trim()
	)?.name;
	if (!name) {
		throw new Error(`Shelter ${shelterCode} has no food distribution point or zone to deliver to`);
	}
	return name.trim();
}

async function loadRecipients(db: string, limit: number): Promise<DistributionRecipient[]> {
	const startkey = encodeURIComponent(JSON.stringify('evacuee:'));
	const endkey = encodeURIComponent(JSON.stringify('evacuee:￰'));
	const { status, data } = await couchReq(
		'GET',
		`/${db}/_all_docs?startkey=${startkey}&endkey=${endkey}&include_docs=true&limit=500`
	);
	if (status !== 200) throw new Error(`Cannot read evacuees from ${db} (HTTP ${status})`);
	type Row = { doc?: { _id: string; household_id?: string; current_stay?: { status?: string } } };
	const recipients = (data as { rows: Row[] }).rows
		.flatMap((r) => (r.doc?.current_stay?.status === 'active' ? [r.doc] : []))
		.map((d) => ({ id: d._id, householdId: d.household_id }));
	if (recipients.length < limit) {
		throw new Error(`Need ${limit} active evacuees in ${db}, found ${recipients.length}`);
	}
	return recipients.slice(0, limit);
}

/** Distribution demo data for one shelter DB. Fixed ids → re-running is a no-op. */
export async function mainDistribution({ shelterCode, scenario, reset }: DistributionSeedOptions) {
	assertLocalCouch();
	const db = shelterDbName(shelterCode);
	const ctx: AuthorContext = { shelterCode, createdBy: DISTRIBUTION_ACTOR };
	const title = scenario === 'desk' ? 'DISTRIBUTION DESK' : 'DISTRIBUTION BACK-OFFICE';
	console.log(`\nSeeding ${title} → ${displayCouchUrl()} / ${db}\n`);

	const catalog = await loadCatalog();
	const destination = await loadDestination(shelterCode);
	let all: { _id: string }[];
	let summary: string;
	if (scenario === 'desk') {
		const people = await loadRecipients(db, DISTRIBUTION_RECIPIENTS_NEEDED);
		const { tickets, logs, ledger } = buildDistributionDocs(catalog, people, destination, ctx);
		all = [...tickets, ...logs, ...ledger];
		summary = `${tickets.length} tickets, ${logs.length} distribution logs, ${ledger.length} ledger rows`;
	} else {
		const { tickets, ledger } = buildBackOfficeDocs(catalog, destination, ctx);
		all = [...tickets, ...ledger];
		summary = `${tickets.length} tickets, ${ledger.length} opening stock lots`;
	}
	summary += ` → ${destination}`;
	const revs = await liveRevs(
		db,
		all.map((d) => d._id)
	);

	if (reset && revs.size > 0) {
		const tombstones = [...revs].map(([_id, _rev]) => ({ _id, _rev, _deleted: true }));
		await bulkDocs(db, tombstones, { allowConflicts: false });
		console.log(`  − removed ${revs.size} previously seeded docs`);
		revs.clear();
	}

	const fresh = all.filter((d) => !revs.has(d._id));
	if (fresh.length === 0) {
		console.log('  ✓ already seeded (use --reset to rewrite)');
		return;
	}
	await bulkDocs(db, fresh, { allowConflicts: false });
	console.log(`  ✓ ${summary}`);
	console.log('\nDistribution seed done.\n');
}
