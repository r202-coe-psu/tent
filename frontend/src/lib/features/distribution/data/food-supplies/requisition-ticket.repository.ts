import { allDocsByType, getDoc, putDoc } from '$lib/db/couch-db';
import { now, type AuthorContext } from '$lib/db/model';
import {
	assertRequisitionTicketMutation,
	assertRequisitionTicketTransition,
	createFlow2RequisitionTicket,
	requisitionTicketDocSchema,
	type Flow2RequisitionTicket,
	type RequisitionTicket,
	type RequisitionTicketInput,
	type RequisitionTicketStatus,
	type RequisitionType,
	type TicketAmendment,
	type TicketItem
} from '../../domain/food-supplies';
import { NotFoundError, resolveShelterDbName, retryCas } from './shared';

export interface RequisitionTicketListFilter {
	status?: RequisitionTicketStatus;
	requisition_type?: RequisitionType;
}

export interface RequisitionTicketTransitionPatch {
	driver_name?: string;
	license_plate?: string;
	notes?: string;
	items?: TicketItem[];
	amendments?: TicketAmendment[];
	approved_by?: string;
	dispatched_by?: string;
	received_by?: string;
}

export interface RequisitionTicketRepository {
	create(
		ticketInput: RequisitionTicketInput | Flow2RequisitionTicket,
		ctx: AuthorContext
	): Promise<Flow2RequisitionTicket>;
	get(ticketId: string): Promise<RequisitionTicket | null>;
	list(filter?: RequisitionTicketListFilter): Promise<RequisitionTicket[]>;
	transitionTicket(
		ticketId: string,
		toStatus: RequisitionTicketStatus,
		ctx: AuthorContext,
		patch?: RequisitionTicketTransitionPatch
	): Promise<RequisitionTicket>;
	mutateTicketCAS(
		ticketId: string,
		mutator: (current: RequisitionTicket) => RequisitionTicket,
		ctx: AuthorContext
	): Promise<RequisitionTicket>;
}

export class RequisitionTicketRemoteRepository implements RequisitionTicketRepository {
	private readonly dbName: string;

	constructor(shelterCodeOrDbName: string) {
		this.dbName = shelterCodeOrDbName.startsWith('shelter_')
			? shelterCodeOrDbName
			: resolveShelterDbName(shelterCodeOrDbName);
	}

	async create(
		ticketInput: RequisitionTicketInput | Flow2RequisitionTicket,
		ctx: AuthorContext
	): Promise<Flow2RequisitionTicket> {
		let doc: Flow2RequisitionTicket;
		if ('_id' in ticketInput && ticketInput.type === 'requisition_ticket') {
			doc = requisitionTicketDocSchema.parse(ticketInput) as Flow2RequisitionTicket;
		} else {
			doc = createFlow2RequisitionTicket(ticketInput as RequisitionTicketInput, ctx);
		}
		return putDoc(this.dbName, doc);
	}

	async get(ticketId: string): Promise<RequisitionTicket | null> {
		const raw = await getDoc<RequisitionTicket>(this.dbName, ticketId);
		if (!raw) return null;
		return requisitionTicketDocSchema.parse(raw);
	}

	async list(filter?: RequisitionTicketListFilter): Promise<RequisitionTicket[]> {
		const docs = await allDocsByType<RequisitionTicket>(
			this.dbName,
			'requisition_ticket',
			(d): d is RequisitionTicket =>
				typeof d === 'object' &&
				d !== null &&
				(d as { type?: string }).type === 'requisition_ticket'
		);
		const parsed = docs.map((d) => requisitionTicketDocSchema.parse(d));
		return parsed.filter((ticket) => {
			if (filter?.status && ticket.status !== filter.status) return false;
			if (filter?.requisition_type && ticket.requisition_type !== filter.requisition_type)
				return false;
			return true;
		});
	}

	async mutateTicketCAS(
		ticketId: string,
		mutator: (current: RequisitionTicket) => RequisitionTicket,
		ctx: AuthorContext
	): Promise<RequisitionTicket> {
		void ctx;
		return retryCas(async () => {
			const current = await this.get(ticketId);
			if (!current) {
				throw new NotFoundError(`Requisition ticket ${ticketId} not found`);
			}

			const computed = mutator(current);
			assertRequisitionTicketMutation(current, computed);

			const next = requisitionTicketDocSchema.parse({
				...computed,
				_id: current._id,
				_rev: current._rev,
				shelter_code: current.shelter_code,
				updated_at: now()
			});

			return putDoc(this.dbName, next);
		});
	}

	async transitionTicket(
		ticketId: string,
		toStatus: RequisitionTicketStatus,
		ctx: AuthorContext,
		patch?: RequisitionTicketTransitionPatch
	): Promise<RequisitionTicket> {
		return this.mutateTicketCAS(
			ticketId,
			(current) => {
				assertRequisitionTicketTransition(current, toStatus);
				return {
					...current,
					status: toStatus,
					...(patch?.driver_name !== undefined ? { driver_name: patch.driver_name } : {}),
					...(patch?.license_plate !== undefined ? { license_plate: patch.license_plate } : {}),
					...(patch?.notes !== undefined ? { notes: patch.notes } : {}),
					...(patch?.items !== undefined ? { items: patch.items } : {}),
					...(patch?.amendments !== undefined ? { amendments: patch.amendments } : {}),
					...(patch?.approved_by !== undefined ? { approved_by: patch.approved_by } : {}),
					...(patch?.dispatched_by !== undefined ? { dispatched_by: patch.dispatched_by } : {}),
					...(patch?.received_by !== undefined ? { received_by: patch.received_by } : {})
				};
			},
			ctx
		);
	}
}
