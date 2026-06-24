export interface DonationItem {
	name: string;
	amount: number;
	unit: string;
	item_id?: string;
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

	selectedShelter = $state('');
	deliveryDate = $state('');

	captchaToken = $state('');
	isSubmitting = $state(false);
	errorMessage = $state('');
	trackingToken = $state('');

	addItem() {
		this.items.push({ name: '', amount: 1, unit: 'ชิ้น' });
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
		this.selectedShelter = '';
		this.deliveryDate = '';
		this.captchaToken = '';
		this.isSubmitting = false;
		this.errorMessage = '';
		this.trackingToken = '';
	}
}

export const donationStore = new DonationStore();
