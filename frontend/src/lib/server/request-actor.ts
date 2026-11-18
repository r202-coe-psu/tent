import { AsyncLocalStorage } from 'node:async_hooks';

type ActorScope = { actor: string | null };

const storage = new AsyncLocalStorage<ActorScope>();

const AUDITED_DB = /^\/(shelter_[a-z0-9_-]+|catalog)(\/|$)/;

export function runWithActorScope<T>(fn: () => T): T {
	return storage.run({ actor: null }, fn);
}

export function runAsActor<T>(actor: string, fn: () => T): T {
	return storage.run({ actor }, fn);
}

export function setRequestActor(actor: string | null | undefined): void {
	const scope = storage.getStore();
	if (scope && actor) scope.actor = actor;
}

export function currentActor(): string | null {
	return storage.getStore()?.actor ?? null;
}

export function withActor<T extends object>(doc: T, actor: string): T {
	const next = { ...doc, updated_by: actor } as T & { created_by?: unknown; _rev?: unknown };
	if (!next._rev && !next.created_by) next.created_by = actor;
	return next;
}

function docWrite(path: string, method: string): 'single' | 'bulk' | null {
	const clean = path.split('?')[0];
	const match = AUDITED_DB.exec(clean);
	if (!match) return null;
	const rest = clean.slice(match[0].length);
	const upper = method.toUpperCase();
	if (upper === 'POST' && rest === '_bulk_docs') return 'bulk';
	if (upper === 'POST' && rest === '') return 'single';
	if (upper === 'PUT' && rest !== '' && !rest.includes('/') && !rest.startsWith('_')) {
		const id = decodeURIComponent(rest);
		return id.startsWith('_') ? null : 'single';
	}
	return null;
}

export function stampAdminWrite(path: string, method: string, body: unknown): unknown {
	const actor = currentActor();
	if (!actor || body === null || typeof body !== 'object') return body;
	const kind = docWrite(path, method);
	if (kind === 'single') return { ...(body as object), updated_by: actor };
	if (kind === 'bulk') {
		const docs = (body as { docs?: unknown }).docs;
		if (!Array.isArray(docs)) return body;
		return {
			...(body as object),
			docs: docs.map((d) => (d && typeof d === 'object' ? { ...d, updated_by: actor } : d))
		};
	}
	return body;
}
