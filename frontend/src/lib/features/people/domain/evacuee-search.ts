/**
 * Staff evacuee search plan (#554): one raw query string is classified into exactly one plan,
 * each plan maps to Mango clauses (one per index), and a literal post-filter trims what the
 * index returns. Pure — the repository owns I/O and paging.
 */
import { normalizeThaiPhone } from '$lib/db/model';
import type { Evacuee } from './people';
import { extractScanLookupToken, toCouchEvacueeId } from './scan-lookup';

export type EvacueeSearchPlan =
	| { kind: 'empty' }
	| { kind: 'scan'; id: string }
	| { kind: 'card'; numbers: readonly string[] }
	| { kind: 'phone'; prefix: string }
	/** `last: null` is the single-word query: the word may start any of first/last/nickname. */
	| { kind: 'name'; first: string; last: string | null };

type PlanOf<K extends EvacueeSearchPlan['kind']> = Extract<EvacueeSearchPlan, { kind: K }>;

/** One Mango clause per index; `key` is stable and identifies the clause inside a cursor. */
export type EvacueeSearchClause = { key: string; selector: Record<string, unknown> };

/** Clause key → CouchDB bookmark, for the clauses that still have rows to give. */
export type EvacueeSearchCursor = Readonly<Record<string, string>>;

export type EvacueeSearchPage = { items: Evacuee[]; nextCursor: EvacueeSearchCursor | null };

const SCAN_SHAPE_RE = /\/onsite\/zoning\/|\/onsite\/medical-screening\/|evacuee_id=|^evacuee:/i;
const BARE_ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const PHONE_SEPARATORS_RE = /[\s\-.()]/g;
const PHONE_PREFIX_RE = /^0\d{0,9}$/;
const INTERNATIONAL_RE = /^\+?66(\d+)$/;
const ALL_DIGITS_RE = /^\d+$/;
const LETTER_RE = /\p{L}/u;
const DIGIT_RE = /\d/;

const collapse = (s: string): string => s.trim().replace(/\s+/g, ' ');
const fold = (s: string | null | undefined): string => collapse(s ?? '').toLowerCase();

function scanPlan(trimmed: string): PlanOf<'scan'> | null {
	if (!SCAN_SHAPE_RE.test(trimmed) && !BARE_ULID_RE.test(trimmed)) return null;
	const token = extractScanLookupToken(trimmed);
	if (!token) return null;
	const [prefix, ...rest] = toCouchEvacueeId(token).split(':');
	return { kind: 'scan', id: `${prefix}:${rest.join(':').toUpperCase()}` };
}

function phonePlan(trimmed: string): PlanOf<'phone'> | null {
	const compact = trimmed.replace(PHONE_SEPARATORS_RE, '');
	const intl = INTERNATIONAL_RE.exec(compact);
	const prefix = intl ? `0${intl[1]}` : compact;
	return PHONE_PREFIX_RE.test(prefix) ? { kind: 'phone', prefix } : null;
}

function cardPlan(trimmed: string): PlanOf<'card'> | null {
	const compact = trimmed.replace(/[\s-]/g, '');
	const isDigits = ALL_DIGITS_RE.test(compact);
	const isMixedToken = !/\s/.test(trimmed) && LETTER_RE.test(compact) && DIGIT_RE.test(compact);
	if (!isDigits && !isMixedToken) return null;
	// `ANON-<ulid>` is stored with its dash, so a letter-bearing token also tries the dash-kept form.
	const bases = isMixedToken ? [trimmed.replace(/\s/g, ''), compact] : [compact];
	const numbers = [...new Set(bases.flatMap((b) => [b, b.toUpperCase()]))];
	return { kind: 'card', numbers };
}

function namePlan(trimmed: string): PlanOf<'name'> {
	const [first, ...rest] = collapse(trimmed).split(' ');
	return { kind: 'name', first, last: rest.length > 0 ? rest.join(' ') : null };
}

export function parseEvacueeSearchQuery(raw: string): EvacueeSearchPlan {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: 'empty' };
	return scanPlan(trimmed) ?? phonePlan(trimmed) ?? cardPlan(trimmed) ?? namePlan(trimmed);
}

// U+FFF0 sorts above every character a name uses, so [p, p+HIGH) is the prefix range.
const HIGH = '\ufff0';
const prefixRange = (p: string) => ({ $gte: p.toLowerCase(), $lt: p + HIGH });
const evacueeSelector = (fields: Record<string, unknown>) => ({ type: 'evacuee', ...fields });

const CLAUSES: { [K in EvacueeSearchPlan['kind']]: (plan: PlanOf<K>) => EvacueeSearchClause[] } = {
	empty: () => [],
	scan: () => [],
	card: ({ numbers }) =>
		numbers.map((n) => ({
			key: `card:${n}`,
			selector: evacueeSelector({ 'person_id.number': n })
		})),
	phone: ({ prefix }) =>
		['phone', 'emergency_contact.phone'].map((field) => ({
			key: field,
			selector: evacueeSelector({ [field]: prefixRange(prefix) })
		})),
	name: ({ first, last }) =>
		last === null
			? ['first_name', 'last_name', 'nickname'].map((field) => ({
					key: field,
					selector: evacueeSelector({ [field]: prefixRange(first) })
				}))
			: [
					{
						key: 'first_name+last_name',
						selector: evacueeSelector({
							first_name: prefixRange(first),
							last_name: prefixRange(last)
						})
					}
				]
};

export function evacueeSearchClauses(plan: EvacueeSearchPlan): readonly EvacueeSearchClause[] {
	return (CLAUSES[plan.kind] as (p: EvacueeSearchPlan) => EvacueeSearchClause[])(plan);
}

/**
 * Literal rule applied to every row the index returns. Mango ranges use ICU collation, which is
 * case-insensitive (wanted) but also matches Thai prefixes the user did not type (`ส` returns
 * `เสือ`, `สม` returns `ส้ม`), so the index result is only a superset.
 */
const MATCHERS: { [K in EvacueeSearchPlan['kind']]: (e: Evacuee, plan: PlanOf<K>) => boolean } = {
	empty: () => false,
	scan: (e, { id }) => e._id === id,
	card: (e, { numbers }) => numbers.includes(e.person_id?.number ?? ''),
	phone: (e, { prefix }) =>
		[e.phone, e.emergency_contact?.phone].some((p) =>
			normalizeThaiPhone(p ?? '').startsWith(prefix)
		),
	name: (e, { first, last }) => {
		const f = fold(first);
		if (last === null) {
			return [e.first_name, e.last_name, e.nickname].some((n) => fold(n).startsWith(f));
		}
		return fold(e.first_name).startsWith(f) && fold(e.last_name).startsWith(fold(last));
	}
};

export function matchesEvacueeSearchPlan(e: Evacuee, plan: EvacueeSearchPlan): boolean {
	return (MATCHERS[plan.kind] as (e: Evacuee, p: EvacueeSearchPlan) => boolean)(e, plan);
}
