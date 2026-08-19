import { z } from 'zod';
import {
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	type SopRatioKey
} from '$lib/features/sop-ratios/domain/sop-ratio';
import { qtyGt, qtyIsZero, subQty } from '$lib/utils/qty';
import {
	dailyCalcDocSchema,
	DAILY_CALC_SCHEMA_VERSION,
	type DailyCalcDoc
} from '../domain/calc.schema';
import { cr042HaveSnapshotIssues } from './have-map';

/** The persisted envelope is stricter than the domain-only formula snapshot. */
export const dailyCalcEnvelopeSchema = z
	.object({
		_id: z.string().regex(/^daily_calc:\d{4}-\d{2}-\d{2}$/),
		_rev: z.string().optional(),
		type: z.string(),
		schema_v: z.number().int().nonnegative(),
		shelter_code: z.string().min(1),
		created_at: z.string().datetime(),
		updated_at: z.string().datetime(),
		created_by: z.string().min(1)
	})
	.passthrough();

export type DailyCalcReadErrorKind =
	'invalid_envelope' | 'wrong_type' | 'unsupported_schema' | 'invalid_schema' | 'invalid_invariant';

/** Read-boundary error that identifies why a persisted snapshot was rejected. */
export class DailyCalcReadError extends Error {
	readonly name = 'DailyCalcReadError';

	constructor(
		readonly kind: DailyCalcReadErrorKind,
		readonly documentId: string,
		message: string
	) {
		super(`${kind} for ${documentId}: ${message}`);
	}
}

const canonicalKeys = new Set<string>(SOP_RATIO_KEYS);

function keySet(value: Record<string, unknown>): Set<string> {
	return new Set(Object.keys(value));
}

function describeKeySet(actual: Set<string>): string {
	const missing = SOP_RATIO_KEYS.filter((key) => !actual.has(key));
	const unknown = [...actual].filter((key) => !canonicalKeys.has(key));
	const details = [];
	if (missing.length) details.push(`missing: ${missing.join(', ')}`);
	if (unknown.length) details.push(`unknown: ${unknown.join(', ')}`);
	return details.join('; ');
}

/**
 * Persisted T-31 records use the CR-042 canonical 20-key contract. The pure domain schema stays
 * generic for formula reuse; this schema is the storage/read-model boundary.
 */
export const canonicalDailyCalcDocSchema = dailyCalcDocSchema.superRefine((doc, ctx) => {
	const ratioKeys = keySet(doc.ratio_snapshot);
	const stockKeys = keySet(doc.stock_snapshot);
	const resultKeys = new Set(doc.results.map((result) => result.key));

	if (ratioKeys.size !== SOP_RATIO_KEYS.length || describeKeySet(ratioKeys)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['ratio_snapshot'],
			message: `Must contain the canonical 20-key set (${describeKeySet(ratioKeys)})`
		});
	}
	if (stockKeys.size !== SOP_RATIO_KEYS.length || describeKeySet(stockKeys)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['stock_snapshot'],
			message: `Must contain the canonical 20-key set (${describeKeySet(stockKeys)})`
		});
	}
	if (resultKeys.size !== SOP_RATIO_KEYS.length || describeKeySet(resultKeys)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['results'],
			message: `Must contain one result for the canonical 20-key set (${describeKeySet(resultKeys)})`
		});
	}
	if (doc.results.length !== SOP_RATIO_KEYS.length) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['results'],
			message: `Must contain exactly ${SOP_RATIO_KEYS.length} results`
		});
	}
	for (const message of cr042HaveSnapshotIssues(doc.stock_snapshot)) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stock_snapshot'], message });
	}
});

export type PersistedDailyCalc = {
	_id: string;
	_rev?: string;
	type: 'daily_calc';
	schema_v: number;
	shelter_code: string;
	created_at: string;
	updated_at: string;
	created_by: string;
} & DailyCalcDoc;

function issueText(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
		.join('; ');
}

/**
 * Checks invariants that are not merely field shape: ordering, snapshot echoing, and the formula
 * result truth table. This deliberately does not recompute `need`, which is governed by the
 * `formula_v` recorded in the snapshot and may differ from today's algorithm.
 */
export function assertDailyCalcInvariants(
	doc: DailyCalcDoc,
	documentId = '<unknown>'
): asserts doc is DailyCalcDoc {
	const errors: string[] = [];
	const rowsByKey = new Map<string, (typeof doc.results)[number]>();

	for (const [ordinal, row] of doc.results.entries()) {
		if (row.ordinal !== ordinal) errors.push(`${row.key}: ordinal must be ${ordinal}`);
		if (rowsByKey.has(row.key)) errors.push(`${row.key}: duplicate result key`);
		rowsByKey.set(row.key, row);

		const key = row.key as SopRatioKey;
		if (SOP_RATIO_KIND[key] !== row.kind) {
			errors.push(`${row.key}: kind does not match the canonical ratio kind`);
		}
		if (row.as_of !== doc.as_of) errors.push(`${row.key}: as_of does not match document`);
		if (row.ratio !== doc.ratio_snapshot[row.key]) {
			errors.push(`${row.key}: ratio does not match ratio_snapshot`);
		}
		if (row.have !== doc.stock_snapshot[row.key]) {
			errors.push(`${row.key}: have does not match stock_snapshot`);
		}

		if (!row.input_valid) {
			if (row.status !== 'insufficient_data' || row.data_status !== 'invalid_input') {
				errors.push(`${row.key}: invalid input must use invalid_input/insufficient_data`);
			}
			if (row.need !== null || row.gap !== null)
				errors.push(`${row.key}: invalid input has output`);
			continue;
		}
		if (row.ratio === null) {
			if (row.need !== null || row.gap !== null || row.status !== 'insufficient_data') {
				errors.push(`${row.key}: missing ratio has an output verdict`);
			}
			if (row.data_status !== 'ratio_missing') {
				errors.push(`${row.key}: missing ratio must use ratio_missing`);
			}
			continue;
		}
		if (row.kind === 'threshold') {
			if (
				row.need !== null ||
				row.gap !== null ||
				row.status !== 'constraint' ||
				row.data_status !== 'complete'
			) {
				errors.push(`${row.key}: threshold row is inconsistent`);
			}
			continue;
		}
		if (row.have === null) {
			if (row.need === null || row.gap !== null || row.status !== 'insufficient_data') {
				errors.push(`${row.key}: missing have is inconsistent`);
			}
			if (row.data_status !== 'stock_unsynced') {
				errors.push(`${row.key}: missing have must use stock_unsynced`);
			}
			continue;
		}
		if (
			row.need === null ||
			row.gap === null ||
			row.data_status !== 'complete' ||
			!['ok', 'gap', 'surplus'].includes(row.status)
		) {
			errors.push(`${row.key}: complete row is inconsistent`);
			continue;
		}
		if (row.gap !== subQty(row.need, row.have)) {
			errors.push(`${row.key}: gap is not need minus have`);
		}
		const expectedStatus = qtyGt(row.gap, 0) ? 'gap' : qtyIsZero(row.gap) ? 'ok' : 'surplus';
		if (row.status !== expectedStatus) {
			errors.push(`${row.key}: status must be ${expectedStatus} for gap ${row.gap}`);
		}
	}

	if (errors.length) {
		throw new DailyCalcReadError('invalid_invariant', documentId, errors.join('; '));
	}
}

/** Parse a persisted daily_calc and fail closed on every contract violation. */
export function parseDailyCalcRecord(input: unknown): PersistedDailyCalc {
	const candidateId =
		input && typeof input === 'object' && '_id' in input && typeof input._id === 'string'
			? input._id
			: '<unknown>';
	const envelope = dailyCalcEnvelopeSchema.safeParse(input);
	if (!envelope.success) {
		throw new DailyCalcReadError('invalid_envelope', candidateId, issueText(envelope.error));
	}
	if (envelope.data.type !== 'daily_calc') {
		throw new DailyCalcReadError(
			'wrong_type',
			candidateId,
			`expected daily_calc, got ${envelope.data.type}`
		);
	}
	if (envelope.data.schema_v !== DAILY_CALC_SCHEMA_VERSION) {
		throw new DailyCalcReadError(
			'unsupported_schema',
			candidateId,
			`expected schema_v ${DAILY_CALC_SCHEMA_VERSION}, got ${envelope.data.schema_v}`
		);
	}

	const body = canonicalDailyCalcDocSchema.safeParse(input);
	if (!body.success) {
		throw new DailyCalcReadError('invalid_schema', candidateId, issueText(body.error));
	}
	assertDailyCalcInvariants(body.data, candidateId);
	return input as PersistedDailyCalc;
}
