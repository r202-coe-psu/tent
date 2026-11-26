import { fakeUlid, type CouchDoc } from '../../lib/couch.ts';
import type { PeopleDocType } from './matrix.ts';

/** Marks every doc these suites write, so a leftover is easy to spot in Fauxton. */
export const PROBE_MARKER = 'PERMTEST';

/**
 * The smallest doc of `type` that passes the shared envelope checks of the shelter
 * `validate_doc_update` (schema.md §0). Each suite also writes it as `system_admin` first,
 * so a refusal for a role is about the role, not about the doc's shape.
 */
export function probeDoc(type: PeopleDocType, shelterCode: string, author: string): CouchDoc {
	const now = new Date().toISOString();
	const envelope = {
		type,
		shelter_code: shelterCode,
		created_at: now,
		updated_at: now,
		created_by: author,
		note: `${PROBE_MARKER} permission probe`
	};
	switch (type) {
		case 'evacuee':
			return {
				_id: `evacuee:${fakeUlid()}`,
				...envelope,
				schema_v: 15,
				first_name: PROBE_MARKER,
				last_name: author
			};
		case 'household':
			return {
				_id: `household:${fakeUlid()}`,
				...envelope,
				schema_v: 5,
				label: `${PROBE_MARKER} ${author}`,
				head_evacuee_id: null,
				status: 'checked_in'
			};
		case 'screening':
			return {
				_id: `screening:${fakeUlid()}`,
				...envelope,
				schema_v: 1,
				evacuee_id: `evacuee:${fakeUlid()}`
			};
		case 'medical':
			return {
				_id: `medical:${fakeUlid()}`,
				...envelope,
				schema_v: 1,
				evacuee_id: `evacuee:${fakeUlid()}`
			};
	}
}
