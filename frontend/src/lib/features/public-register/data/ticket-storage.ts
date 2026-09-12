/**
 * Local storage manager for public pre-registration tickets.
 *
 * Persists issued tickets on the citizen's device so that when they arrive
 * at the evacuation center, they can instantly open their booking ticket and
 * Person QR code even if they reload the page or navigate away.
 */
import type { BookingTicket } from '../application/booking-store.svelte';

const STORAGE_KEY = 'smartshelter_public_booking_tickets';
const MAX_TICKETS = 20;

export function getStoredTickets(): BookingTicket[] {
	if (typeof localStorage === 'undefined') {
		return [];
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed;
	} catch (e) {
		console.warn('Failed to read booking tickets from localStorage:', e);
		return [];
	}
}

export function getLatestStoredTicket(): BookingTicket | null {
	const tickets = getStoredTickets();
	return tickets.length > 0 ? tickets[0] : null;
}

export function saveTicketToStorage(ticket: BookingTicket): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	try {
		const current = getStoredTickets();
		// Remove existing entry with same code if any, then prepend the new one
		const filtered = current.filter((t) => t.code !== ticket.code);
		const updated = [ticket, ...filtered].slice(0, MAX_TICKETS);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
	} catch (e) {
		console.warn('Failed to save booking ticket to localStorage:', e);
	}
}

export function removeStoredTicket(code: string): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	try {
		const current = getStoredTickets();
		const updated = current.filter((t) => t.code !== code);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
	} catch (e) {
		console.warn('Failed to remove booking ticket from localStorage:', e);
	}
}

export function clearStoredTickets(): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (e) {
		console.warn('Failed to clear booking tickets from localStorage:', e);
	}
}
