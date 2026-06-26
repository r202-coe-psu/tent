export interface DonationItem {
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
			category: 'Food',
			name: '',
			amount: 1,
			unit: 'ชิ้น',
			condition: '',
			remark: ''
		}
	]);

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	trackingToken = $state('');

	addItem() {
		this.items.push({
			category: 'Food',
			name: '',
			amount: 1,
			unit: 'ชิ้น',
			condition: '',
			remark: ''
		});
	}

	removeItem(index: number) {
		this.items = this.items.filter((_, i) => i !== index);
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
		this.items = [
			{
				category: 'Food',
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
	}
}

import { setContext, getContext } from "svelte";
const DONATION_KEY = Symbol("DONATION");
export function setDonationStore() {
	return setContext(DONATION_KEY, new DonationStore());
}
export function getDonationStore() {
	return getContext<DonationStore>(DONATION_KEY);
}
