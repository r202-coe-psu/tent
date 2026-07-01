export interface DonationItem {
	id: string;
	item_id?: string; // catalog item id from a picked need card → lets needs_open decrease
	category?: string;
	name: string;
	amount: number;
	unit: string;
	condition?: string;
	remark?: string;
}

export type TabStep = 'needs' | 'form' | 'time' | 'ticket';

class DonationStore {
	activeTab = $state<TabStep>('needs');
	reachedStep = $state(1); // 1: needs, 2: form, 3: time, 4: ticket

	donorName = $state('');
	donorPhone = $state('');
	donorLine = $state('');
	donorEmail = $state('');

	deliveryMethod = $state<'self_dropoff' | 'parcel' | 'shelter_pickup'>('self_dropoff');
	vehicleType = $state<'motorcycle' | 'car' | 'pickup' | 'truck' | undefined>(undefined);
	slotDate = $state('');
	slotTime = $state('');
	shelterCode = $state('');
	courierTrackingNo = $state('');
	eta = $state('');
	pickupAddress = $state('');

	items = $state<DonationItem[]>([
		{
			id: crypto.randomUUID(),
			category: 'food',
			name: '',
			amount: 1,
			unit: 'ชิ้น',
			condition: '',
			remark: ''
		}
	]);

	// ขั้น 3 — จุดส่งมอบ + วันเวลา (เก็บไว้โช๋วบนตั๋ว)
	selectedShelter = $state('SH001');
	selectedShelterName = $state('');
	shelterLocked = $state(false); // true = มาจากการ์ด needs board → ล็อกศูนย์ปลายทาง (DN)
	deliveryDate = $state('');

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	trackingToken = $state('');
	bookingRef = $state('');

	addItem() {
		this.items.push({
			id: crypto.randomUUID(),
			category: 'food',
			name: '',
			amount: 1,
			unit: 'ชิ้น',
			condition: '',
			remark: ''
		});
	}

	removeItem(id: string) {
		this.items = this.items.filter((item) => item.id !== id);
	}

	reset() {
		this.activeTab = 'needs';
		this.reachedStep = 1;
		this.donorName = '';
		this.donorPhone = '';
		this.donorLine = '';
		this.donorEmail = '';
		this.deliveryMethod = 'self_dropoff';
		this.vehicleType = undefined;
		this.slotDate = '';
		this.slotTime = '';
		this.shelterCode = '';
		this.courierTrackingNo = '';
		this.eta = '';
		this.pickupAddress = '';
		this.selectedShelter = 'SH001';
		this.selectedShelterName = '';
		this.shelterLocked = false;
		this.deliveryDate = '';
		this.items = [
			{
				id: crypto.randomUUID(),
				category: 'food',
				name: '',
				amount: 1,
				unit: 'ชิ้น',
				condition: '',
				remark: ''
			}
		];
		this.captchaToken = '';
		this.isSubmitting = false;
		this.errorMessage = '';
		this.trackingToken = '';
		this.bookingRef = '';
	}
}

import { setContext, getContext } from 'svelte';
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
