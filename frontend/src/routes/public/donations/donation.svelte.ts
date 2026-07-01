export interface DonationItem {
	// stable client id สำหรับ keyed {#each}
	id?: string;
	name: string;
	amount: number;
	unit: string;
	item_id?: string;
	// schema_v 2 (DN) — เก็บเป็น string ('' = ไม่ระบุ); ส่งเป็น undefined ตอน submit
	category: string;
	condition: string;
	note: string;
}

export type TabStep = 'needs' | 'form' | 'time' | 'ticket';

class DonationStore {
	activeTab = $state<TabStep>('needs');
	reachedStep = $state(1); // 1: needs, 2: form, 3: time, 4: ticket

	donorName = $state('');
	donorPhone = $state('');
	donorLine = $state('');
	donorEmail = $state('');
	taxReceipt = $state(false);

	items = $state<DonationItem[]>([]);

	// ขั้น 3 — จุดส่งมอบ + วันเวลา (เก็บไว้โชว์บนตั๋ว)
	selectedShelter = $state('SH001');
	selectedShelterName = $state('');
	shelterLocked = $state(false); // true = มาจากการ์ด needs board → ล็อกศูนย์ปลายทาง (DN)
	deliveryDate = $state('');
	pickupAddress = $state('');

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	trackingToken = $state('');
	bookingRef = $state('');

	addItem() {
		this.items.push({
			id: crypto.randomUUID(),
			name: '',
			amount: 1,
			unit: 'ชิ้น',
			category: '',
			condition: '',
			note: ''
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
		this.taxReceipt = false;
		this.items = [];
		this.selectedShelter = 'SH001';
		this.selectedShelterName = '';
		this.shelterLocked = false;
		this.deliveryDate = '';
		this.pickupAddress = '';
		this.captchaToken = '';
		this.isSubmitting = false;
		this.errorMessage = '';
		this.trackingToken = '';
		this.bookingRef = '';
	}
}

export const donationStore = new DonationStore();
