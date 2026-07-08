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
		reserved: number;
		onHand: number;
		target: number;
		unit: string;
		isCutOff: boolean;
		isManualClosed: boolean;
	}[];
	campaignDoc: DonationCampaign;
}
