/**
 * Pure demo metadata shared by the client feature module and the server-side
 * admin endpoint. Contains no browser- or server-only imports so it is safe to
 * load from either context.
 */

export const DEMO_DBS = ['demo_alpha', 'demo_beta', 'demo_shared'] as const;
export type DemoDb = (typeof DEMO_DBS)[number];

export const DEMO_USERS = [
	{ name: 'alice',   password: 'alice1234', roles: ['team:alpha'],            desc: 'สาขา alpha เท่านั้น' },
	{ name: 'bob',     password: 'bob12345',  roles: ['team:beta'],             desc: 'สาขา beta เท่านั้น' },
	{ name: 'charlie', password: 'charlie1',  roles: ['team:alpha', 'team:beta'], desc: 'ทั้งสองสาขา' }
] as const;

export const DB_META: Record<DemoDb, { label: string; requiredRoles: string[]; pattern: string }> = {
	demo_alpha:  { label: 'Alpha DB',  requiredRoles: ['team:alpha'],            pattern: 'Pattern 1 — DB-level' },
	demo_beta:   { label: 'Beta DB',   requiredRoles: ['team:beta'],             pattern: 'Pattern 1 — DB-level' },
	demo_shared: { label: 'Shared DB', requiredRoles: ['team:alpha', 'team:beta'], pattern: 'Pattern 2 — Doc-level write' }
};

export interface SetupStep {
	label: string;
	status: 'ok' | 'skip' | 'error';
	detail?: string;
}

export interface DbVerifyResult {
	db: string;
	exists: boolean;
	security: { admins: unknown; members: unknown } | null;
	error?: string;
}

export interface UserVerifyResult {
	name: string;
	roles: string[] | null;
	error?: string;
}

export interface VerifyResult {
	databases: DbVerifyResult[];
	users: UserVerifyResult[];
}
