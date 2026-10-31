import type { DonationCampaign, NeedCloseState } from '../domain/operations';

/** View model for the back-office donation needs board (one row per campaign). */
export interface NeedItem {
	id: string;
	title: string;
	location: string;
	showOnHome: boolean;
	/** Campaign-level only: `closed` when the campaign is, else `open` (used by a needless campaign's row). */
	closeState: NeedCloseState;
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
		/** The one value a board row's badge, bar, buttons and filter read (#817). */
		closeState: NeedCloseState;
		isManualClosed: boolean;
		/** Staff-assigned drop-off point; `null` when unset (FR-AP-1). */
		dropOffPointId: string | null;
	}[];
	campaignDoc: DonationCampaign;
}
