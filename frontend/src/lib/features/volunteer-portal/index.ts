/**
 * Volunteer Access Portal + ตารางทำงานจิตอาสา (CR-092 หน้าจอ 2 + 6).
 *
 * Scope is the volunteer's own view of their commitments: sign in with the phone number
 * they applied with or a ticket code, see the shifts they hold, open the Digital Pass
 * they present at the gate. The public Job Board (หน้าจอ 1) is a separate slice owned
 * elsewhere — see `tent_backup_code/`.
 *
 * The only entry point other code may import.
 */
export {
	DISPATCH_STATUSES,
	SHIFT_STATUSES,
	dispatchRespondSchema,
	responseCodeSchema,
	TICKET_STATUSES,
	isUpcomingShift,
	isValidThaiNationalId,
	needsDispatchResponse,
	shiftStatusLabel,
	ticketFindSchema,
	ticketStatusLabel,
	volunteerApplySchema
} from './domain/volunteer';
export type {
	DispatchRespondInput,
	DispatchStatus,
	JobShiftTemplate,
	ScheduleShift,
	ShiftStatus,
	PublicJob,
	TicketFindInput,
	TicketShift,
	TicketStatus,
	TicketSummary,
	VolunteerApplyInput,
	VolunteerTicket
} from './domain/volunteer';

export {
	useCancelTicketMutation,
	useFindTicketsMutation,
	useRespondToDispatchMutation,
	useVolunteerSchedule,
	useVolunteerTicket,
	useVolunteerTickets,
	volunteerPortalKeys
} from './application/queries';

export { default as VolunteerSchedule } from './ui/volunteer-schedule.svelte';
export { default as TicketFinder } from './ui/ticket-finder.svelte';
export { default as DigitalPass } from './ui/digital-pass.svelte';
export { default as VolunteerAccessPortal } from './ui/volunteer-access-portal.svelte';
