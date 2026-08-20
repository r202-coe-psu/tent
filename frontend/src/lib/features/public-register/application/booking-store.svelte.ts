import { getContext, setContext } from 'svelte';
import type { PublicShelterCardModel } from '$lib/features/public-portal';

export type BookingStep = 'shelter' | 'person' | 'ticket';

export interface BookingTicket {
	code: string;
	shelter_code: string;
	shelter_name: string;
	first_name: string;
	status: string;
	booked_at: string;
}

/**
 * Wizard state for the public booking flow (CR-070 / T-71).
 *
 * Lives in the feature slice rather than the route directory so the step
 * components can reach it through the barrel — the donations wizard keeps its
 * store under `routes/(public)/donations/` and its form components in
 * `$lib/components/form/`, which forces those components to import back out of
 * `routes/`. Don't repeat that.
 */
class BookingStore {
	activeStep = $state<BookingStep>('shelter');
	/** Highest step the citizen has legitimately reached (1-based, gates the stepper). */
	reachedStep = $state(1);

	shelterCode = $state('');
	shelterName = $state('');
	/** Arrived via `?shelter=CODE` from a shelter detail page — step 1 is skipped. */
	shelterLocked = $state(false);

	firstName = $state('');
	lastName = $state('');
	gender = $state<'male' | 'female' | 'other' | ''>('');
	phone = $state('');

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	ticket = $state<BookingTicket | null>(null);

	selectShelter(shelter: Pick<PublicShelterCardModel, 'code' | 'name'>) {
		this.shelterCode = shelter.code;
		this.shelterName = shelter.name;
	}

	goTo(step: BookingStep, stepNumber: number) {
		this.activeStep = step;
		if (stepNumber > this.reachedStep) this.reachedStep = stepNumber;
	}

	reset() {
		this.activeStep = 'shelter';
		this.reachedStep = 1;
		this.shelterCode = '';
		this.shelterName = '';
		this.shelterLocked = false;
		this.firstName = '';
		this.lastName = '';
		this.gender = '';
		this.phone = '';
		this.captchaToken = '';
		this.isSubmitting = false;
		this.errorMessage = '';
		this.ticket = null;
	}
}

export type { BookingStore };

const BOOKING_KEY = Symbol('PUBLIC_BOOKING');

export function setBookingStore(): BookingStore {
	return setContext(BOOKING_KEY, new BookingStore());
}

export function getBookingStore(): BookingStore {
	const store = getContext<BookingStore>(BOOKING_KEY);
	if (!store) {
		throw new Error('getBookingStore must be used under a component that called setBookingStore');
	}
	return store;
}
