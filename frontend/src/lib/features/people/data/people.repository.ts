import type { AuthorContext } from '$lib/db/model';
import type { Evacuee, EvacueeInput } from '../domain/people';

/**
 * Persistence contract for the `people` feature. The application layer depends
 * on this interface — never on PouchDB directly — so the store can be swapped
 * (in-memory in tests) without touching queries or UI.
 *
 * The device writes local PouchDB first; the ULID minted by the factory is the
 * idempotency key. Conflict resolution beyond append-only retry is a central
 * repair job (data-model.md §5) — do not merge here.
 */
export interface PeopleRepository {
	/** Mint an evacuee from form input + author context and persist it. */
	createEvacuee(input: EvacueeInput, ctx: AuthorContext): Promise<Evacuee>;
	/** Every evacuee in this shelter database. */
	listEvacuees(): Promise<Evacuee[]>;
	/** One evacuee by `_id`, or `null` when absent. */
	getEvacuee(id: string): Promise<Evacuee | null>;
	/** Persist an edited evacuee (LWW: bumps `updated_at`). */
	updateEvacuee(evacuee: Evacuee): Promise<Evacuee>;
}
