import { getDoc, putDoc } from '$lib/db/couch-db';
import { now, type AuthorContext } from '$lib/db/model';
import {
	assertLoanReturnReservationTransition,
	loanReturnReservationDocSchema,
	type LoanReturnReservation,
	type LoanReturnReservationMode,
	type LoanReturnReservationStatus,
	type ReturnCondition,
	type NonPhysicalClearReason
} from '../../domain/food-supplies';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

export interface ReinitializeLoanReturnReservationInput {
	operation_id: string;
	mode: LoanReturnReservationMode;
	operation_by?: string;
	qty_returned?: string;
	return_condition?: ReturnCondition;
	bulk_pool_id?: string;
	claimed_qty?: string;
	clear_reason?: NonPhysicalClearReason;
	notes?: string;
}

export interface LoanReturnReservationRepository {
	create(reservation: LoanReturnReservation): Promise<LoanReturnReservation>;
	get(reservationId: string): Promise<LoanReturnReservation | null>;
	mutateStatusCAS(
		reservationId: string,
		targetStatus: LoanReturnReservationStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<LoanReturnReservation>;
	reinitializeCAS(
		reservationId: string,
		input: ReinitializeLoanReturnReservationInput,
		ctx?: AuthorContext
	): Promise<LoanReturnReservation>;
	mutateCAS(
		reservationId: string,
		mutator: (current: LoanReturnReservation) => LoanReturnReservation
	): Promise<LoanReturnReservation>;
}

export class LoanReturnReservationRemoteRepository implements LoanReturnReservationRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(reservation: LoanReturnReservation): Promise<LoanReturnReservation> {
		const doc = loanReturnReservationDocSchema.parse(reservation);
		return putDoc(this.dbName, doc);
	}

	async get(reservationId: string): Promise<LoanReturnReservation | null> {
		const raw = await getDoc<LoanReturnReservation>(this.dbName, reservationId);
		if (!raw) return null;
		return loanReturnReservationDocSchema.parse(raw);
	}

	async mutateCAS(
		reservationId: string,
		mutator: (current: LoanReturnReservation) => LoanReturnReservation
	): Promise<LoanReturnReservation> {
		return retryCas(async () => {
			const current = await this.get(reservationId);
			if (!current) {
				throw new NotFoundError(`Loan return reservation ${reservationId} not found`);
			}
			const next = mutator(current);
			assertLoanReturnReservationTransition(current, next);
			return putDoc(this.dbName, next);
		});
	}

	async mutateStatusCAS(
		reservationId: string,
		targetStatus: LoanReturnReservationStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<LoanReturnReservation> {
		void maybeCtx;
		const notes = typeof notesOrCtx === 'string' ? notesOrCtx : undefined;
		return this.mutateCAS(reservationId, (current) => {
			if (current.status === targetStatus) {
				return current;
			}
			return loanReturnReservationDocSchema.parse({
				...current,
				status: targetStatus,
				...(notes !== undefined ? { notes } : {}),
				updated_at: now()
			});
		});
	}

	async reinitializeCAS(
		reservationId: string,
		input: ReinitializeLoanReturnReservationInput,
		ctx?: AuthorContext
	): Promise<LoanReturnReservation> {
		const operationBy = ctx?.createdBy ?? input.operation_by ?? 'system';

		return this.mutateCAS(reservationId, (current) => {
			if (current.status !== 'ABORTED' && current.status !== 'COMMITTED') {
				throw new Error(
					`Cannot reinitialize reservation ${reservationId} in status ${current.status}; must be ABORTED or COMMITTED`
				);
			}
			return loanReturnReservationDocSchema.parse({
				...current,
				operation_id: input.operation_id,
				mode: input.mode,
				status: 'RESERVED' as const,
				operation_by: operationBy,
				qty_returned: input.qty_returned,
				return_condition: input.return_condition,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				clear_reason: input.clear_reason,
				notes: input.notes ?? current.notes,
				updated_at: now()
			});
		});
	}
}
