export interface SavedDonation {
	_id: string;
	tracking_token: string;
	tracking_token_hash: string;
	shelter_code: string;
	donor: { name: string; phone: string };
	/** schema_v 2 — free-text items from the donor */
	items: { free_text: string; qty: number; unit: string; category?: string; condition?: string; note?: string }[];
	status: 'declared' | 'received' | 'expired';
	received_summary?: string | null;
	created_at: string;
	expires_at: string;
}

type SaveDonationInput = Omit<
	SavedDonation,
	'_id' | 'status' | 'received_summary' | 'created_at' | 'expires_at'
>;

// TODO: implement with a real storage backend (MongoDB or CouchDB admin).
export async function saveDonation(_input: SaveDonationInput): Promise<SavedDonation> {
	throw new Error('saveDonation: storage backend not configured');
}

export async function getDonationByHash(_hash: string): Promise<SavedDonation | null> {
	throw new Error('getDonationByHash: storage backend not configured');
}
