/**
 * M5 batch orchestration for the BFF (draft CR — referral M5 integration §4, §5).
 *
 * Server-only. Reads evacuees and the shelter master with admin rights, builds the TRF-002
 * payload server-side (the browser never sends national IDs), calls FastAPI, then writes the
 * referral docs. M5 is the source of truth: if a CouchDB write fails after M5 accepted, the
 * sync worker repairs the referral from `m5_transfers` (D7) and a resend replays idempotently.
 */
import { adminRaw } from '$lib/server/couch-admin';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { IntegrationError, integrationRequest } from '$lib/server/integrations';
import { ulid } from '$lib/db/ulid';
import { isEvacuee } from '$lib/features/people/domain/people';
import type { EvacueeSummary, Referral, ReferralExternal } from '../domain/referral.schema';
import {
	M5PayloadError,
	buildM5TransferPayload,
	isM5Referral,
	m5BatchInputSchema,
	type M5BatchInput,
	type M5EvacueeSource
} from '../domain/referral.m5';
import type { CouchDbReferralServerRepository } from './referral.server-repository';
import { transitionWithRetry } from './referral.transition-retry';

/** A batch-level failure with the HTTP status and machine code the route should answer. */
export class M5BatchError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly extra: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'M5BatchError';
	}
}

type BatchRepo = Pick<
	CouchDbReferralServerRepository,
	'findByBatchId' | 'createM5Batch' | 'update' | 'transition'
>;

export type M5BatchContext = {
	repo: BatchRepo;
	shelterCode: string;
	actor: string;
};

export type M5MemberFailure = { id: string; error: string };

type TransferResult = { code: string; status: ReferralExternal['status']; external_ref: string };

function toBatchError(e: unknown): never {
	if (e instanceof M5BatchError) throw e;
	if (e instanceof IntegrationError) throw new M5BatchError(e.status, e.code, e.message, e.extra);
	if (e instanceof M5PayloadError) throw new M5BatchError(422, e.code, e.message);
	throw e;
}

async function loadMembers(ctx: M5BatchContext, batchId: string): Promise<Referral[]> {
	const members = await ctx.repo.findByBatchId(batchId, ctx.shelterCode);
	if (!members.length) throw new M5BatchError(404, 'NOT_FOUND', 'ไม่พบชุดส่งต่อนี้');
	if (!members.every(isM5Referral)) {
		throw new M5BatchError(409, 'NOT_M5_BATCH', 'ชุดนี้ไม่ใช่การส่งผ่าน OneData (M5)');
	}
	return members;
}

function externalOf(r: Referral): ReferralExternal | undefined {
	return 'external' in r ? r.external : undefined;
}

/** Evacuee docs by id from `shelter_{code}` (admin read; one round trip). */
async function loadEvacuees(
	shelterCode: string,
	ids: readonly string[]
): Promise<Map<string, M5EvacueeSource>> {
	const res = await adminRaw(`/${shelterDbName(shelterCode)}/_all_docs?include_docs=true`, 'POST', {
		keys: [...new Set(ids)]
	});
	const rows = (res.data as { rows?: { id?: string; doc?: unknown }[] })?.rows ?? [];
	const out = new Map<string, M5EvacueeSource>();
	for (const row of rows) {
		if (row.id && isEvacuee(row.doc)) out.set(row.id, row.doc);
	}
	return out;
}

async function settle<T>(
	items: readonly T[],
	run: (item: T) => Promise<Referral>,
	idOf: (item: T) => string
): Promise<{ written: Referral[]; failed: M5MemberFailure[] }> {
	const written: Referral[] = [];
	const failed: M5MemberFailure[] = [];
	for (const item of items) {
		try {
			written.push(await run(item));
		} catch (e: unknown) {
			failed.push({ id: idOf(item), error: e instanceof Error ? e.message : 'Unknown error' });
		}
	}
	return { written, failed };
}

// ---------------------------------------------------------------------------
// Create (FR-B2)
// ---------------------------------------------------------------------------

/**
 * Validate and create one M5 batch as drafts. Every evacuee must exist in the shelter and have
 * no open referral. Returns the new `batch_id` and the created docs.
 */
export async function createM5Batch(
	ctx: M5BatchContext & {
		hasActiveReferral: (evacueeId: string) => Promise<boolean>;
	},
	raw: unknown
): Promise<{ input: M5BatchInput; batchId: string; referrals: Referral[] }> {
	const parsed = m5BatchInputSchema.safeParse(raw);
	if (!parsed.success) {
		throw new M5BatchError(
			400,
			'VALIDATION',
			parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'
		);
	}
	const input = parsed.data;
	const ids = input.patients.map((p) => p.evacuee_id);
	const evacuees = await loadEvacuees(ctx.shelterCode, ids);
	const missing = ids.filter((id) => !evacuees.has(id));
	if (missing.length) {
		throw new M5BatchError(422, 'EVACUEE_NOT_FOUND', 'ไม่พบผู้ประสบภัยบางคนในศูนย์', {
			evacuee_ids: missing
		});
	}
	const busy: string[] = [];
	for (const id of ids) if (await ctx.hasActiveReferral(id)) busy.push(id);
	if (busy.length) {
		throw new M5BatchError(
			409,
			'ACTIVE_REFERRAL',
			'ผู้ประสบภัยบางคนมีคำร้องส่งต่อที่ยังดำเนินการอยู่ กรุณาปิดคำร้องเดิมก่อน',
			{ evacuee_ids: busy }
		);
	}

	const summaries = new Map<string, EvacueeSummary>(
		ids.map((id) => {
			const e = evacuees.get(id) as M5EvacueeSource & { gender?: string | null };
			return [
				id,
				{ first_name: e.first_name, last_name: e.last_name ?? '', gender: e.gender ?? undefined }
			];
		})
	);
	const batchId = ulid();
	const referrals = await ctx.repo.createM5Batch(
		input,
		batchId,
		{ shelterCode: ctx.shelterCode, createdBy: ctx.actor },
		summaries
	);
	return { input, batchId, referrals };
}

// ---------------------------------------------------------------------------
// Submit (draft → sent, TRF-002)
// ---------------------------------------------------------------------------

export async function submitM5Batch(
	ctx: M5BatchContext,
	batchId: string
): Promise<{ transfer: TransferResult; referrals: Referral[]; failed: M5MemberFailure[] }> {
	try {
		const members = await loadMembers(ctx, batchId);
		// The batch as M5 sees it: everything not cancelled. Already-sent members are included so
		// a resend after a partial write builds the identical body and M5 replays (D7).
		const active = members.filter((m) => m.status === 'draft' || m.status === 'sent');
		if (!active.length) {
			throw new M5BatchError(409, 'BATCH_CLOSED', 'ชุดนี้ไม่มีผู้ป่วยที่รอส่งแล้ว');
		}
		const sentExternal = active.map(externalOf).find(Boolean);
		if (sentExternal && active.every((m) => m.status === 'sent')) {
			return {
				transfer: {
					code: sentExternal.code,
					status: sentExternal.status,
					external_ref: sentExternal.external_ref
				},
				referrals: active,
				failed: []
			};
		}

		const [evacuees, shelter] = await Promise.all([
			loadEvacuees(
				ctx.shelterCode,
				active.map((m) => m.evacuee_id)
			),
			findMasterByCode(ctx.shelterCode)
		]);
		if (!shelter) throw new M5BatchError(500, 'SHELTER_NOT_FOUND', 'ไม่พบข้อมูลศูนย์');
		const payload = buildM5TransferPayload({
			referrals: active,
			evacuees,
			shelter: { code: shelter.code, name: shelter.name, location: shelter.location }
		});
		const transfer = await integrationRequest<TransferResult>(
			'POST',
			'/v1/integrations/m5/transfers',
			{ ...payload, actor: ctx.actor }
		);

		const external: ReferralExternal = {
			system: 'm5',
			external_ref: payload.external_ref,
			code: transfer.code,
			status: transfer.status
		};
		const drafts = active.filter((m) => m.status === 'draft');
		const { written, failed } = await settle(
			drafts,
			(m) =>
				transitionWithRetry(ctx.repo, m._id, 'sent', ctx.actor, undefined, ctx.shelterCode, {
					channel: 'batch',
					patch: (doc) => ({ ...doc, external })
				}),
			(m) => m._id
		);
		// The sync worker may have repaired a member to `sent` first (D7): not a failure.
		let stillFailed = failed;
		if (failed.length) {
			const fresh = new Map(
				(await ctx.repo.findByBatchId(batchId, ctx.shelterCode)).map((m) => [m._id, m])
			);
			stillFailed = failed.filter((f) => fresh.get(f.id)?.status !== 'sent');
			for (const f of failed) {
				const doc = fresh.get(f.id);
				if (doc?.status === 'sent') written.push(doc);
			}
		}
		return {
			transfer,
			referrals: [...active.filter((m) => m.status === 'sent'), ...written],
			failed: stillFailed
		};
	} catch (e: unknown) {
		toBatchError(e);
	}
}

// ---------------------------------------------------------------------------
// Start (TRF-005, rule 5)
// ---------------------------------------------------------------------------

export async function startM5Batch(
	ctx: M5BatchContext,
	batchId: string
): Promise<{ referrals: Referral[]; failed: M5MemberFailure[] }> {
	try {
		const members = await loadMembers(ctx, batchId);
		const linked = members.filter((m) => externalOf(m) && m.status !== 'closed');
		const external = linked.map(externalOf).find(Boolean);
		if (!external) throw new M5BatchError(409, 'NOT_SENT', 'ชุดนี้ยังไม่ได้ส่งผ่าน OneData (M5)');
		if (external.status !== 'pending') {
			throw new M5BatchError(409, 'NOT_PENDING', 'แจ้งรถออกได้หลัง สธ. อนุมัติแล้วเท่านั้น', {
				status: external.status
			});
		}
		await integrationRequest('POST', `/v1/integrations/m5/transfers/${external.code}/start`, {
			actor: ctx.actor
		});
		// Status stays `accepted`; only the mirror changes. The worker writes the leave
		// movement (D9) when it sees `in_transit`.
		return await settle(
			linked,
			async (m) =>
				(await ctx.repo.update(m._id, (doc) => {
					const ext = externalOf(doc);
					return ext ? ({ ...doc, external: { ...ext, status: 'in_transit' } } as Referral) : null;
				})) ?? m,
			(m) => m._id
		).then(({ written, failed }) => ({ referrals: written, failed }));
	} catch (e: unknown) {
		toBatchError(e);
	}
}

// ---------------------------------------------------------------------------
// Withdraw (TRF-006, rules 3 and 6)
// ---------------------------------------------------------------------------

/** The batch input that recreates `remaining` as a new draft batch (rule 6). */
function resubmitInput(remaining: readonly Referral[]): M5BatchInput {
	const head = remaining[0] as Referral & {
		transport?: M5BatchInput['transport'];
		requester_contact?: M5BatchInput['requester_contact'];
		acuity?: M5BatchInput['patients'][number]['acuity'];
	};
	return m5BatchInputSchema.parse({
		to_org: {
			name: head.to_org?.name,
			m5_facility_id: head.to_org?.m5_facility_id,
			...(head.to_org?.contact ? { contact: head.to_org.contact } : {})
		},
		urgency: head.urgency,
		transport: head.transport,
		requester_contact: head.requester_contact,
		notes: head.notes,
		patients: remaining.map((r) => ({
			evacuee_id: r.evacuee_id,
			acuity: (r as typeof head).acuity,
			reason: r.reason
		})),
		submit: false
	});
}

export async function cancelM5Batch(
	ctx: M5BatchContext,
	batchId: string,
	reason: string,
	resubmitWithout?: readonly string[]
): Promise<{ closed: Referral[]; failed: M5MemberFailure[]; new_batch_id: string | null }> {
	try {
		const members = await loadMembers(ctx, batchId);
		// Approved by MOPH: only MOPH can cancel now (M5 `cancel_needs_moph`).
		if (members.some((m) => m.status === 'accepted')) {
			throw new M5BatchError(
				409,
				'CANCEL_NEEDS_MOPH',
				'ใบนี้ สธ. อนุมัติแล้ว โทรประสาน สธ. เพื่อยกเลิก'
			);
		}
		const open = members.filter((m) => m.status === 'draft' || m.status === 'sent');
		if (!open.length) throw new M5BatchError(409, 'BATCH_CLOSED', 'ชุดนี้ปิดไปแล้ว');

		const sentExternal = open.map(externalOf).find(Boolean);
		if (sentExternal) {
			await integrationRequest(
				'POST',
				`/v1/integrations/m5/transfers/${sentExternal.code}/cancel`,
				{ reason, actor: ctx.actor }
			);
		}

		// Closed only after M5 accepted the withdrawal (rule 3).
		const { written, failed } = await settle(
			open,
			(m) =>
				transitionWithRetry(ctx.repo, m._id, 'closed', ctx.actor, reason, ctx.shelterCode, {
					channel: 'batch',
					patch: (doc) => {
						const ext = externalOf(doc);
						return ext ? ({ ...doc, external: { ...ext, status: 'cancelled' } } as Referral) : doc;
					}
				}),
			(m) => m._id
		);

		let newBatchId: string | null = null;
		if (resubmitWithout && !failed.length) {
			const excluded = new Set(resubmitWithout);
			const remaining = open.filter((m) => !excluded.has(m._id));
			if (remaining.length) {
				newBatchId = ulid();
				await ctx.repo.createM5Batch(
					resubmitInput(remaining),
					newBatchId,
					{ shelterCode: ctx.shelterCode, createdBy: ctx.actor },
					new Map(remaining.map((r) => [r.evacuee_id, r.evacuee_summary]))
				);
			}
		}
		return { closed: written, failed, new_batch_id: newBatchId };
	} catch (e: unknown) {
		toBatchError(e);
	}
}
