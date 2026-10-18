import type { DonationCampaign } from '../domain/operations';

/** View model for the back-office donation needs board (one row per campaign). */
export interface NeedItem {
	id: string;
	title: string;
	location: string;
	showOnHome: boolean;
	isCutOff: boolean;
	isManualClosed: boolean;
	needs: {
		itemId: string;
		name: string;
		reserved: string;
		onHand: string;
		target: string;
		/** What donors can still book: 0 once the need is cut off. */
		remaining: string;
		unit: string;
		isCutOff: boolean;
		isManualClosed: boolean;
	}[];
	campaignDoc: DonationCampaign;
}
