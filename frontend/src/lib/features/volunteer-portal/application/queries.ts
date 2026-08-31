import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	cancelTicket,
	fetchSchedule,
	findTickets,
	getTicket,
	respondToDispatch
} from '../data/volunteer-api';

export const volunteerPortalKeys = {
	all: ['volunteer-portal'] as const,
	ticket: (token: string) => [...volunteerPortalKeys.all, 'ticket', token] as const,
	schedule: (phone: string) => [...volunteerPortalKeys.all, 'schedule', phone] as const,
	tickets: (phone: string) => [...volunteerPortalKeys.all, 'tickets', phone] as const
};

export function useVolunteerTicket(token: () => string) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.ticket(token()),
		queryFn: () => getTicket(token()),
		enabled: Boolean(token()),
		retry: false
	}));
}

export function useFindTicketsMutation() {
	return createMutation(() => ({
		mutationFn: (phone: string) => findTickets(phone)
	}));
}

export function useCancelTicketMutation() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (token: string) => cancelTicket(token),
		onSuccess: (_data, token: string) => {
			void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.ticket(token) });
		}
	}));
}

/**
 * ตารางทำงานจิตอาสา for one phone number.
 *
 * A query rather than a mutation even though the lookup posts: the portal keeps showing
 * the schedule after sign-in, and check-in state moves while a shift is running, so it
 * has to be refetchable by key.
 */
export function useVolunteerSchedule(phone: () => string) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.schedule(phone()),
		queryFn: () => fetchSchedule(phone()),
		enabled: Boolean(phone()),
		staleTime: 0
	}));
}

/**
 * The signed-in volunteer's tickets, as a query rather than the one-shot mutation the
 * standalone finder uses.
 *
 * The portal keeps them on screen for as long as the session lasts and has to be able
 * to refetch — a status can move from รอการพิจารณา to ยืนยันแล้ว while the tab is open.
 */
export function useVolunteerTickets(phone: () => string) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.tickets(phone()),
		queryFn: () => findTickets(phone()),
		enabled: Boolean(phone()),
		staleTime: 0
	}));
}

/**
 * Answer an offered shift. Invalidates the schedule so the card disappears and the
 * status badge moves without the volunteer having to reload.
 */
export function useRespondToDispatchMutation(phone: () => string) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (vars: { assignment_id: string; code: string; action: 'accepted' | 'declined' }) =>
			respondToDispatch({ ...vars, phone: phone() }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.schedule(phone()) });
		}
	}));
}
