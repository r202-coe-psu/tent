import type { AuthorContext } from '$lib/db/model';
import type { Scenario, ScenarioResult } from '../domain/scenario.schema';

export const SCENARIO_ID_PREFIX = 'simulation';

export interface ScenarioSummary {
	id: string;
	name: string;
	occupancy: number;
	days: number;
	override_count: number;
	created_at: string;
	created_by: string;
}

export interface ScenarioPage {
	items: ScenarioSummary[];
	nextCursor: string | null;
}

export interface ScenarioRepository {
	save(result: ScenarioResult, ctx: AuthorContext): Promise<Scenario>;
	listPage(cursor?: string | null, limit?: number): Promise<ScenarioPage>;
	get(id: string): Promise<Scenario | null>;
}
