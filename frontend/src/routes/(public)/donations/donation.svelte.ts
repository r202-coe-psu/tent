import { setContext, getContext, tick } from 'svelte';
import { ulid } from '$lib/db/ulid';
import { scrollAppToTop } from '$lib/utils/scroll-app-to-top';
import { DonorPhotos } from '$lib/features/donations';

export interface DonationItem {
	id: string;
	item_id?: string; // catalog item id from a picked need card → lets needs_open decrease
	category?: string;
	name: string;
	amount: number;
	/**
	 * What the donor SEES and, for a walk-in donation, types themselves — a Thai label
	 * such as "กก." or "ก้อน". Never sent as the donation's `unit` when the line came
	 * from the catalog: see `unit_code` (R-15.4).
	 */
	unit: string;
	/**
	 * `item_master.base_unit` of the picked need card (e.g. `kg`, `bar`), set together
	 * with `item_id`. `schema.md §2.1` requires `items[].unit` to equal this whenever
	 * `item_id` is present, and the intake counter rejects anything else with
	 * `CATALOG_MISMATCH` — so the payload takes this, not the label above (R-15.4).
	 */
	unit_code?: string;
	/**
	 * Point of the board card this line came from (FR-AP-13): `null` = a card with no point,
	 * undefined = a typed line. Sent as `need_drop_off_point_id` so the BFF picks that card's campaign.
	 */
	needDropOffPointId?: string | null;
	condition?: string;
	remark?: string;
	/** UI-only hint: units still short on the need card this line came from. Never sent. */
	needQty?: number;
}

/** One booked line as the booking answered it (staff-assigned drop-off FR-AP-8b). */
export type BookedItem = { drop_off_point_id: string | null; review_status: string };

/**
 * A fresh donation line. `amount` always starts at 0 (#822): the donor must type a
 * quantity on purpose, and the shortfall from the need card is only shown as a hint.
 */
export function newDonationItem(
	init: Partial<Omit<DonationItem, 'id' | 'amount' | 'needQty'>> & { qty_needed?: number } = {}
): DonationItem {
	const { qty_needed, ...rest } = init;
	return {
		id: ulid(),
		category: 'food',
		name: '',
		unit: 'piece',
		condition: 'new',
		remark: '',
		...rest,
		amount: 0,
		...(qty_needed !== undefined && qty_needed > 0 ? { needQty: qty_needed } : {})
	};
}

export type TabStep = 'needs' | 'shelter-details' | 'form' | 'time' | 'ticket';

export class DonationStore {
	activeTab = $state<TabStep>('needs');
	reachedStep = $state(1); // 1: needs, 2: form, 3: time, 4: ticket
	flowMode = $state<'solicited' | 'unsolicited'>('solicited');
	selectedShelterForNeeds = $state<string | null>(null);

	donorName = $state('');
	donorPhone = $state('');
	donorLine = $state('');
	donorEmail = $state('');

	deliveryMethod = $state<'self_dropoff' | 'parcel' | 'shelter_pickup'>('self_dropoff');
	vehicleType = $state<'motorcycle' | 'car' | 'pickup' | 'truck' | undefined>(undefined);
	/** Optional plate for a self drop-off. Kept when the donor switches method, never sent then. */
	vehiclePlate = $state('');
	slotDate = $state('');
	slotTime = $state('');
	/** The shelter / day / queue `slotTime` was picked for (`slotContextKey`). */
	slotFor = $state('');
	/** The plate the booking actually sent — what the ticket shows (CR-209 FR-3a). */
	bookedVehiclePlate = $state('');
	shelterCode = $state('');
	courierTrackingNo = $state('');
	eta = $state('');
	pickupAddress = $state('');

	/**
	 * Booking-level donor photos (CR-175 FR-1, FR-2) — unsolicited mode only, and bound to
	 * `shelterCode`: an uploaded photo lives in that shelter's DB.
	 */
	photos = new DonorPhotos();

	items = $state<DonationItem[]>([newDonationItem()]);

	// ขั้น 3 — จุดส่งมอบ + วันเวลา (เก็บไว้โชว์บนตั๋ว)
	selectedShelter = $state('');
	selectedShelterName = $state('');
	shelterLocked = $state(false); // true = มาจากการ์ด needs board → ล็อกศูนย์ปลายทาง (DN)
	deliveryDate = $state('');

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	trackingToken = $state('');
	bookingRef = $state('');
	/** Status FastAPI gave the booking (CR-174 FR-15) — `verifying` gets the QR on the ticket. */
	bookingStatus = $state('');
	/** Each line's point and review, in `items` order — what the ticket groups by. */
	bookedItems = $state<BookedItem[]>([]);

	/**
	 * Move the wizard to `step` and bring its header into view. Steps are state on this
	 * page, not routes, so the layout's `afterNavigate → scrollAppToTop` never runs — every
	 * step change goes through here instead of assigning `activeTab` directly (#620).
	 */
	goToStep(step: TabStep) {
		this.activeTab = step;
		void tick().then(scrollAppToTop);
	}

	addItem() {
		this.items.push(newDonationItem());
	}

	removeItem(id: string) {
		this.items = this.items.filter((item) => item.id !== id);
	}

	reset() {
		this.goToStep('needs');
		this.reachedStep = 1;
		this.flowMode = 'solicited';
		this.selectedShelterForNeeds = null;
		this.donorName = '';
		this.donorPhone = '';
		this.donorLine = '';
		this.donorEmail = '';
		this.deliveryMethod = 'self_dropoff';
		this.vehicleType = undefined;
		this.vehiclePlate = '';
		this.slotDate = '';
		this.slotTime = '';
		this.slotFor = '';
		this.bookedVehiclePlate = '';
		this.shelterCode = '';
		this.courierTrackingNo = '';
		this.eta = '';
		this.pickupAddress = '';
		this.selectedShelter = '';
		this.selectedShelterName = '';
		this.shelterLocked = false;
		this.deliveryDate = '';
		this.items = [newDonationItem()];
		this.captchaToken = '';
		this.isSubmitting = false;
		this.errorMessage = '';
		this.trackingToken = '';
		this.bookingRef = '';
		this.bookingStatus = '';
		this.bookedItems = [];
		this.photos.clear();
	}
}

const DONATION_KEY = Symbol('DONATION');
export function setDonationStore() {
	return setContext(DONATION_KEY, new DonationStore());
}
export function getDonationStore() {
	const store = getContext<DonationStore>(DONATION_KEY);
	if (!store)
		throw new Error(
			'getDonationStore must be used within a component that called setDonationStore'
		);
	return store;
}
