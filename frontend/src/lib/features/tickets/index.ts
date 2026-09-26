// Public barrel — the only entry point other code may import from this feature.

// Domain — types
export type {
	RequisitionTicket,
	RequisitionType,
	TicketStatus,
	TicketItem,
	TicketGasDrawdown,
	CreateTicketInput,
	TicketItemInput,
	TicketGasDrawdownInput
} from './domain/ticket';

// Domain — schemas, factories, guards, labels
export {
	requisitionTypeSchema,
	ticketStatusSchema,
	TICKET_STATUS_LABELS,
	createTicketInputSchema,
	createTicket,
	isRequisitionTicket,
	allocateTicketItem,
	updateTicketRequestedItems,
	oneStepApproveTicket,
	approveTicket,
	markTicketDispatched,
	receiveTicket,
	cancelTicket,
	resolveTicketItemUnit
} from './domain/ticket';
export { nextTicketNo } from './domain/ticket-no';

// Data — repository and remote CouchDB binding
export type { TicketRepository } from './data/ticket.repository';
export { ticketRepository } from './data/ticket.remote';

// Application — query hooks and live-query wiring
export {
	ticketKeys,
	useTickets,
	useTicket,
	useActiveTicketByMealPlanId,
	useCreateTicket,
	useAllocateTicketItem,
	useUpdateTicketItems,
	useOneStepApproveTicket,
	useApproveTicket,
	useDispatchTicket,
	useReceiveTicket,
	useCancelTicket,
	startTicketsLiveQuery
} from './application/queries';

// UI
export { default as TicketList } from './ui/ticket-list.svelte';
export { default as TicketDetail } from './ui/ticket-detail.svelte';
