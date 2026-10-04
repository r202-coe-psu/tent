import { z } from 'zod';
import { ulid } from './ulid';

/**
 * Shared document model — the "common envelope" every CouchDB doc carries
 * (docs/data/schema.md §0) plus the helpers that stamp it.
 *
 * Pure / isomorphic: knows nothing about PouchDB. Feature domains build their
 * concrete doc types on top of `BaseDoc` and mint them through `makeDoc`.
 */

/** ISO-8601 UTC timestamp. */
export type Timestamp = string;

/** Fields present on every document in a catalog database. */
export interface CatalogDoc {
	_id: string;
	_rev?: string;
	type: string;
	schema_v: number;
	created_at: Timestamp;
	updated_at: Timestamp;
	created_by: string;
}

export function catalogDoc<T extends string, B extends object>(
	type: T,
	schemaV: number,
	body: B,
	createdBy: string,
	id: string = ulid()
): CatalogDoc & { type: T } & B {
	const ts = now();
	return {
		_id: makeDocId(type, id),
		type,
		schema_v: schemaV,
		created_at: ts,
		updated_at: ts,
		created_by: createdBy,
		...body
	};
}

/** Fields present on every document in a catalog database. */
export interface CatalogDoc {
	_id: string;
	_rev?: string;
	type: string;
	schema_v: number;
	created_at: Timestamp;
	updated_at: Timestamp;
	created_by: string;
}

/** Fields present on every document in a shelter database. */
export interface BaseDoc {
	_id: string;
	_rev?: string;
	type: string;
	schema_v: number;
	shelter_code: string;
	created_at: Timestamp;
	updated_at: Timestamp;
	created_by: string;
}

/** Context the caller supplies once per session to stamp authored docs. */
export interface AuthorContext {
	shelterCode: string;
	createdBy: string;
	roles?: readonly string[];
}

/** `"{type}:{ulid}"` — the canonical id shape (schema.md §0). */
export function makeDocId(type: string, id: string = ulid()): string {
	return id.startsWith(`${type}:`) ? id : `${type}:${id}`;
}

/** Current instant as an ISO-8601 UTC string. */
export function now(): Timestamp {
	return new Date().toISOString();
}

/**
 * Stamp the common envelope onto a type-specific body, minting a ULID `_id`.
 * For append-only docs `created_at === updated_at` (schema.md §0); mutating a
 * doc later should bump `updated_at` via `touch`.
 */
export function makeDoc<T extends string, B extends object>(
	type: T,
	schemaV: number,
	body: B,
	ctx: AuthorContext,
	id: string = ulid()
): BaseDoc & { type: T } & B {
	const ts = now();
	return {
		_id: makeDocId(type, id),
		type,
		schema_v: schemaV,
		shelter_code: ctx.shelterCode,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy,
		...body
	};
}

/** Return a copy of a mutable doc with a fresh `updated_at` (LWW conflict key). */
export function touch<T extends { updated_at: Timestamp }>(doc: T): T {
	return { ...doc, updated_at: now() };
}

// ---------------------------------------------------------------- shared zod

/**
 * Normalize a Thai phone as typed (CR-148): drop spaces / dashes / dots / parentheses, then map the
 * country-code forms `+66XXXXXXXXX` / `66XXXXXXXXX` (9 digits after 66) to `0XXXXXXXXX`.
 * Anything else is returned with only the separators removed — validation decides if it is valid.
 */
export function normalizeThaiPhone(value: string): string {
	const compact = value.trim().replace(/[\s\-.()]/g, '');
	const intl = /^\+?66(\d{8,9})$/.exec(compact);
	return intl ? `0${intl[1]}` : compact;
}

/**
 * Keystroke filter for phone inputs (CR-148 FR-10): keeps digits and a leading `+`, caps the
 * length for the typed form, and collapses a complete `+66…` / `66…` number to `0…` as soon as
 * it is recognisable. Partial country-code input (`+66 8`) is kept so the user can finish typing.
 */
export function sanitizePhoneTyping(value: string): string {
	const plus = value.trim().startsWith('+');
	const digits = value.replace(/\D/g, '');
	if (plus) return normalizeThaiPhone(`+${digits.slice(0, 11)}`);
	if (digits.startsWith('66') && digits.length > 10) return normalizeThaiPhone(digits.slice(0, 11));
	return digits.slice(0, digits.startsWith('66') ? 11 : 10);
}

/** Thai-friendly phone field: empty / 「ไม่มี」→ null; `+66` normalized; otherwise digits only. */
export const phoneSchema = z
	.union([
		z.null(),
		z.literal(''),
		z
			.string({ error: 'กรุณากรอกเบอร์โทรศัพท์' })
			.trim()
			.transform(normalizeThaiPhone)
			.pipe(z.string().regex(/^[0-9]+$/, 'กรุณากรอกเบอร์โทรศัพท์เป็นตัวเลขเท่านั้น'))
	])
	.transform((val): string | null => (val === '' || val === null ? null : val));

/**
 * Reusable enum for the registration channel.
 *
 * `kiosk` = Smart Card Kiosk walk-in.
 * `staff` = Onsite staff intake desk walk-in.
 * `backoffice` = Back-office administrator intake.
 * `web` = Public self-booking through the portal (CR-070 D-REG-VIA, T-71).
 * `import` = Bulk spreadsheet import.
 * `paper` = Paper-based intake.
 * `app` = Legacy onsite application alias.
 */
export const registeredViaSchema = z.enum([
	'kiosk',
	'staff',
	'backoffice',
	'app',
	'web',
	'import',
	'paper'
]);

/**
 * Codify the shelter-code shape used across registry + docs (schema.md §3.1):
 * `^SH\d{3,}$` — 1–999 padded to 3 digits (`SH001`), ≥1000 widens (`SH1000`).
 */
export const shelterCodeSchema = z
	.string()
	.regex(/^SH\d{3,}$/, 'Shelter code must look like SH001');

/**
 * Special schema for global/system layers (e.g., Audit Trail or System Config)
 * that allows identifying the context as the central database ('catalog').
 */
export const auditShelterCodeSchema = z.union([shelterCodeSchema, z.literal('catalog')]);
