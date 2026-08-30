import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { couchDbFetch } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc, type AuthorContext } from '$lib/db/model';
import {
	SCENARIO_SCHEMA_VERSION,
	scenarioResultSchema,
	scenarioSchema,
	type Scenario,
	type ScenarioResult
} from '../domain/scenario.schema';
import {
	SCENARIO_ID_PREFIX,
	type ScenarioPage,
	type ScenarioRepository,
	type ScenarioSummary
} from './scenario.repository';

interface ScenarioRowsResponse {
	rows: Array<{ id: string; doc?: unknown; value?: { deleted?: boolean } }>;
}

export class ScenarioRemoteRepository implements ScenarioRepository {
	private readonly repository: Repository;
	private readonly dbName: string;

	constructor(dbName: string = getShelterDb()) {
		this.dbName = dbName;
		this.repository = createRemoteRepository(dbName);
	}

	async save(result: ScenarioResult, ctx: AuthorContext): Promise<Scenario> {
		const parsedResult = scenarioResultSchema.parse(result);
		if (parsedResult.snapshot.shelter_code !== ctx.shelterCode) {
			throw new Error('Scenario result shelter does not match the save context');
		}
		const scenario = scenarioSchema.parse(
			makeDoc(SCENARIO_ID_PREFIX, SCENARIO_SCHEMA_VERSION, { result: parsedResult }, ctx)
		);
		return scenarioSchema.parse(await this.repository.put(scenario));
	}

	async listPage(cursor: string | null = null, limit = 20): Promise<ScenarioPage> {
		const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
		const start = cursor ?? `${SCENARIO_ID_PREFIX}:\ufff0`;
		const end = `${SCENARIO_ID_PREFIX}:`;
		const query = new URLSearchParams({
			include_docs: 'true',
			descending: 'true',
			startkey: JSON.stringify(start),
			endkey: JSON.stringify(end),
			limit: String(safeLimit + 1),
			...(cursor ? { skip: '1' } : {})
		});
		const response = await couchDbFetch<ScenarioRowsResponse>(
			this.dbName,
			`/_all_docs?${query.toString()}`
		);
		const parsed = response.rows.flatMap((row) => {
			if (!row.doc) {
				if (row.value?.deleted === true) return [];
				throw new Error(`CouchDB returned an empty scenario document for ${row.id}`);
			}
			const scenario = scenarioSchema.parse(row.doc);
			if (scenario._id !== row.id)
				throw new Error(`Scenario row/document id mismatch for ${row.id}`);
			return [scenario];
		});
		const pageItems = parsed.slice(0, safeLimit);
		const items: ScenarioSummary[] = pageItems.map((scenario) => ({
			id: scenario._id,
			name: scenario.result.input.name,
			occupancy: scenario.result.input.occupancy,
			days: scenario.result.input.days,
			override_count: Object.keys(scenario.result.input.ratio_overrides).length,
			created_at: scenario.created_at,
			created_by: scenario.created_by
		}));
		return {
			items,
			nextCursor: parsed.length > safeLimit ? (pageItems.at(-1)?._id ?? null) : null
		};
	}

	async get(id: string): Promise<Scenario | null> {
		if (!id.startsWith(`${SCENARIO_ID_PREFIX}:`)) return null;
		const value = await this.repository.get<{ _id: string }>(id);
		if (value === null) return null;
		return scenarioSchema.parse(value);
	}

	async delete(id: string, ctx: AuthorContext): Promise<void> {
		if (!id.startsWith(`${SCENARIO_ID_PREFIX}:`)) return;
		const value = await this.repository.get<{ _id: string }>(id);
		if (value === null) return;
		const scenario = scenarioSchema.parse(value);
		if (scenario.shelter_code !== ctx.shelterCode) {
			throw new Error('Scenario does not belong to the delete context');
		}
		await this.repository.remove(scenario);
	}
}

let singleton: ScenarioRepository | null = null;
let singletonDbName: string | null = null;

export function scenarioRepository(shelterCode?: string): ScenarioRepository {
	const dbName = getShelterDb(shelterCode);
	if (!singleton || singletonDbName !== dbName) {
		singleton = new ScenarioRemoteRepository(dbName);
		singletonDbName = dbName;
	}
	return singleton;
}
