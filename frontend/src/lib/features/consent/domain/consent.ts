import { z } from 'zod';
import { ulid } from '$lib/db/ulid';
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';
import { CONSENT_COPY, CONSENT_NOTICE_VERSION } from './consent-notice.i18n';

export const CONSENT_MODES = ['full', 'basic'] as const;
export const CONSENT_GIVERS = ['self', 'guardian', 'household_member', 'backfill'] as const;
export const CONSENT_CHANNELS = ['staff', 'kiosk', 'web', 'backfill'] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];
export type ConsentGiver = (typeof CONSENT_GIVERS)[number];
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export type BlockChannel = Exclude<ConsentChannel, 'backfill'>;

export const EVACUEE_SCHEMA_V = 15 as const;

export const BACKFILL_NOTICE_VERSION = 'backfill';

const CONSENT_REF_PATTERN = '^CS-[0-9A-HJKMNP-TV-Z]{8}$';
/**
 * ISO 8601 datetime that requires a time and a `Z`/`+HH:MM` offset. This is what
 * `z.iso.datetime({ offset: true })` accepts; the VDU uses the same pattern because
 * `Date.parse` alone also takes date-only and offset-less strings.
 */
const ISO_DATETIME_PATTERN =
	'^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$';
const consentRefSchema = z.string().regex(new RegExp(CONSENT_REF_PATTERN));
const isoTimestampSchema = z.iso.datetime({ offset: true });

const evacueeIdSchema = z.string().regex(/^evacuee:/);

const consentCommonSchema = z.object({
	ref: consentRefSchema,
	given_at: isoTimestampSchema,
	notice_version: z.string().min(1),
	channel: z.enum(CONSENT_CHANNELS),
	recorded_verbally_by: z.string().min(1).nullable()
});

const consentModeSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('full'), health: z.boolean() }),
	z.object({ mode: z.literal('basic'), health: z.literal(false) })
]);

const consentGiverSchema = z.discriminatedUnion('given_by', [
	z.object({ given_by: z.literal('self'), giver_evacuee_id: z.null() }),
	z.object({ given_by: z.literal('backfill'), giver_evacuee_id: z.null() }),
	z.object({ given_by: z.literal('guardian'), giver_evacuee_id: evacueeIdSchema }),
	z.object({ given_by: z.literal('household_member'), giver_evacuee_id: evacueeIdSchema })
]);

export const evacueeConsentSchema = consentCommonSchema
	.and(consentModeSchema)
	.and(consentGiverSchema)
	.superRefine((consent, ctx) => {
		if ((consent.channel === 'backfill') !== (consent.given_by === 'backfill')) {
			ctx.addIssue({
				code: 'custom',
				path: ['channel'],
				message: 'channel backfill and given_by backfill must go together'
			});
		}
		if (consent.recorded_verbally_by !== null && consent.channel !== 'staff') {
			ctx.addIssue({
				code: 'custom',
				path: ['recorded_verbally_by'],
				message: 'verbal recording is only possible on the staff channel'
			});
		}
	});
export type EvacueeConsent = z.infer<typeof evacueeConsentSchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type UnboundConsent = DistributiveOmit<EvacueeConsent, 'giver_evacuee_id'>;

export interface SurfaceCaps {
	verbal: boolean;
}

export const SURFACE_CAPS: Record<BlockChannel, SurfaceCaps> = {
	staff: { verbal: true },
	web: { verbal: false },
	kiosk: { verbal: false }
};

/**
 * D17/D21: a new decision is always `full` and names no guardian members. `guardian_for` stays
 * in the payload (always empty) so the endpoints keep their shape; stored `basic`/`guardian`
 * consents from before stay readable through `evacueeConsentSchema`.
 */
function decisionSchemaFor(caps: SurfaceCaps) {
	return z.strictObject({
		mode: z.literal('full'),
		health: z.boolean(),
		search_visible: z.boolean(),
		guardian_for: z.array(z.string()).max(0),
		verbal: caps.verbal ? z.boolean() : z.literal(false),
		ref: consentRefSchema,
		given_at: isoTimestampSchema,
		notice_version: z.string().min(1)
	});
}

export function consentDecisionSchemaFor(channel: BlockChannel) {
	return decisionSchemaFor(SURFACE_CAPS[channel]);
}
export type ConsentDecision = z.infer<ReturnType<typeof decisionSchemaFor>>;

export interface ConsentStamp {
	ref: string;
	given_at: string;
	notice_version: string;
}

export function mintConsentStamp(now: Date = new Date()): ConsentStamp {
	return {
		ref: `CS-${ulid(now.getTime()).slice(-8)}`,
		given_at: now.toISOString(),
		notice_version: CONSENT_NOTICE_VERSION
	};
}

export interface ConsentMember {
	key: string;
	alreadyConsented: boolean;
}

export interface PlanConsentOptions {
	channel: BlockChannel;
	members: readonly ConsentMember[];
	recordedBy: string | null;
}

export interface MemberConsentPlan {
	key: string;
	consent: UnboundConsent;
	searchExcluded: boolean;
	medicalAllowed: boolean;
}

/**
 * The only implementation of FR-11, FR-30 to FR-33 and the FR-41 skip.
 * members[0] is the registrant (`self`), everyone else is `household_member` (D17). Members already consented get no plan.
 */
export function planRegistrationConsent(
	decision: ConsentDecision,
	opts: PlanConsentOptions
): readonly MemberConsentPlan[] {
	const { channel, members, recordedBy } = opts;
	const caps = SURFACE_CAPS[channel];
	if (members.length === 0) throw new Error('consent needs at least one member');
	if (new Set(members.map((m) => m.key)).size !== members.length) {
		throw new Error('consent member keys must be unique');
	}
	if (decision.verbal && !caps.verbal) {
		throw new Error(`channel ${channel} cannot record consent verbally`);
	}
	if (decision.verbal && !recordedBy) {
		throw new Error('verbal consent needs the recording staff user');
	}
	const registrantKey = members[0].key;
	const health = decision.health;
	const searchExcluded = !decision.search_visible;
	const common = {
		ref: decision.ref,
		given_at: decision.given_at,
		notice_version: decision.notice_version,
		channel,
		recorded_verbally_by: decision.verbal ? recordedBy : null
	};

	return members
		.filter((member) => !member.alreadyConsented)
		.map((member) => {
			const given_by =
				member.key === registrantKey ? ('self' as const) : ('household_member' as const);
			return {
				key: member.key,
				consent: { ...common, mode: 'full' as const, health, given_by },
				searchExcluded,
				medicalAllowed: health
			};
		});
}

export interface MemberConsentWrite {
	key: string;
	consent: EvacueeConsent;
	searchExcluded: boolean;
	medicalAllowed: boolean;
}

export function bindConsent(
	plan: MemberConsentPlan,
	registrantEvacueeId: string
): MemberConsentWrite {
	const unbound = plan.consent;
	const consent: EvacueeConsent =
		unbound.given_by === 'self' || unbound.given_by === 'backfill'
			? { ...unbound, giver_evacuee_id: null }
			: { ...unbound, giver_evacuee_id: registrantEvacueeId };
	return {
		key: plan.key,
		consent,
		searchExcluded: plan.searchExcluded,
		medicalAllowed: plan.medicalAllowed
	};
}

export function resolveRegistrationConsent(
	decision: ConsentDecision,
	members: readonly (ConsentMember & { evacueeId: string })[],
	opts: Omit<PlanConsentOptions, 'members'>
): ReadonlyMap<string, MemberConsentWrite> {
	const plans = planRegistrationConsent(decision, { ...opts, members });
	const registrantEvacueeId = members[0].evacueeId;
	return new Map(plans.map((plan) => [plan.key, bindConsent(plan, registrantEvacueeId)]));
}

/**
 * FR-12 default for C3. New people start visible. When any person the block will write to is
 * already search-excluded, start unticked so nobody is pulled back into search by accident (T-40).
 */
export function initialSearchVisible(targets: readonly { search_excluded: boolean }[]): boolean {
	return !targets.some((target) => target.search_excluded);
}

export interface ConsentSummaryRow {
	key: 'mode' | 'general' | 'health' | 'search' | 'verbal' | 'time' | 'ref';
	label: string;
	value: string;
	consented?: boolean;
	mono?: boolean;
}

export interface ConsentSummary {
	title: string;
	rows: readonly ConsentSummaryRow[];
	footer: string;
}

export function formatConsentTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
		timeZone: DISPLAY_TIME_ZONE,
		calendar: 'buddhist',
		numberingSystem: 'latn',
		hourCycle: 'h23',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')} ${CONSENT_COPY.summary.timeSuffix}`;
}

export function summarizeConsent(
	consent: EvacueeConsent,
	searchExcluded: boolean,
	extras: {
		staff?: { name: string; userId: string } | null;
	} = {}
): ConsentSummary {
	const copy = CONSENT_COPY.summary;
	const basic = consent.mode === 'basic';
	const yesNo = (key: ConsentSummaryRow['key'], label: string, consented: boolean) => ({
		key,
		label,
		value: consented ? copy.yes : copy.no,
		consented
	});

	const rows: ConsentSummaryRow[] = [
		{
			key: 'mode',
			label: copy.mode,
			value: basic ? copy.modeBasic : copy.modeFull
		},
		yesNo('general', copy.general, !basic),
		yesNo('health', copy.health, consent.health),
		yesNo('search', copy.search, !searchExcluded)
	];
	if (consent.recorded_verbally_by !== null) {
		const staff = extras.staff;
		rows.push({
			key: 'verbal',
			label: copy.verbal,
			value: staff ? `${staff.name} (${staff.userId})` : consent.recorded_verbally_by,
			mono: true
		});
	}
	rows.push(
		{ key: 'time', label: copy.time, value: formatConsentTime(consent.given_at), mono: true },
		{ key: 'ref', label: copy.ref, value: consent.ref, mono: true }
	);

	return {
		title: CONSENT_COPY.result.title,
		rows,
		footer: CONSENT_COPY.result.withdrawNote
	};
}

export function backfillConsent(
	evacuee: { consent?: unknown; anonymized?: boolean },
	hasMedicalDoc: boolean,
	now: Date
): EvacueeConsent | null {
	if (evacuee.consent !== undefined && evacuee.consent !== null) return null;
	if (evacuee.anonymized === true) return null;
	const { ref, given_at } = mintConsentStamp(now);
	return {
		mode: 'full',
		health: hasMedicalDoc,
		ref,
		given_at,
		notice_version: BACKFILL_NOTICE_VERSION,
		given_by: 'backfill',
		giver_evacuee_id: null,
		recorded_verbally_by: null,
		channel: 'backfill'
	};
}

/**
 * ES5 source for the shelter `validate_doc_update` (FR-34). Splice it BEFORE the
 * `isCouchAdmin` early return: kiosk and the backfill script write as admin.
 * Runs in an IIFE so its vars cannot collide with the host function. Checks only when
 * `newDoc.consent` is present. Immutability is not enforced so withdrawal can change it later.
 */
export function consentVduClause(): string {
	const list = (values: readonly string[]) => JSON.stringify(values);
	return `
  if (newDoc.type === 'evacuee' && newDoc.consent !== undefined) (function () {
    var consent = newDoc.consent;
    var consentFail = function (why) { throw { forbidden: 'consent ' + why }; };
    if (consent === null || typeof consent !== 'object' || consent instanceof Array) {
      consentFail('must be an object');
    }
    var consentKeys = ['mode', 'health', 'ref', 'given_at', 'given_by', 'giver_evacuee_id', 'recorded_verbally_by', 'channel', 'notice_version'];
    for (var ci = 0; ci < consentKeys.length; ci++) {
      if (!Object.prototype.hasOwnProperty.call(consent, consentKeys[ci])) {
        consentFail('missing ' + consentKeys[ci]);
      }
    }
    if (${list(CONSENT_MODES)}.indexOf(consent.mode) === -1) consentFail('mode is invalid');
    if (${list(CONSENT_GIVERS)}.indexOf(consent.given_by) === -1) consentFail('given_by is invalid');
    if (${list(CONSENT_CHANNELS)}.indexOf(consent.channel) === -1) consentFail('channel is invalid');
    if (typeof consent.health !== 'boolean') consentFail('health must be boolean');
    if (consent.mode === 'basic' && consent.health !== false) consentFail('basic mode cannot have health consent');
    if (typeof consent.ref !== 'string' || !/${CONSENT_REF_PATTERN}/.test(consent.ref)) consentFail('ref is invalid');
    var givenAt = typeof consent.given_at === 'string' ? /${ISO_DATETIME_PATTERN}/.exec(consent.given_at) : null;
    if (!givenAt || isNaN(Date.parse(consent.given_at))) consentFail('given_at is invalid');
    if (new Date(Date.UTC(Number(givenAt[1]), Number(givenAt[2]) - 1, Number(givenAt[3]))).getUTCDate() !== Number(givenAt[3])) {
      consentFail('given_at is invalid');
    }
    if (typeof consent.notice_version !== 'string' || consent.notice_version === '') consentFail('notice_version is invalid');
    if (consent.recorded_verbally_by !== null && (typeof consent.recorded_verbally_by !== 'string' || consent.recorded_verbally_by === '')) {
      consentFail('recorded_verbally_by is invalid');
    }
    if ((consent.channel === 'backfill') !== (consent.given_by === 'backfill')) {
      consentFail('channel backfill and given_by backfill must go together');
    }
    if (consent.recorded_verbally_by !== null && consent.channel !== 'staff') {
      consentFail('verbal recording is only possible on the staff channel');
    }
    if (consent.given_by === 'self' || consent.given_by === 'backfill') {
      if (consent.giver_evacuee_id !== null) consentFail('giver_evacuee_id must be null for ' + consent.given_by);
    } else if (typeof consent.giver_evacuee_id !== 'string' || consent.giver_evacuee_id.indexOf('evacuee:') !== 0) {
      consentFail('giver_evacuee_id must be an evacuee id for ' + consent.given_by);
    }
    if (consent.mode === 'basic' && !(newDoc.privacy && newDoc.privacy.search_excluded === true)) {
      consentFail('basic mode requires privacy.search_excluded');
    }
  })();
`;
}
