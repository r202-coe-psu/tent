class WalkInSession {
	citizenId = $state<string | null>(null);
	consented = $state(false);
	consentedAt = $state<string | null>(null);

	begin(citizenId: string): void {
		this.citizenId = citizenId;
		this.consented = false;
		this.consentedAt = null;
	}

	consent(): void {
		if (this.citizenId) {
			this.consented = true;
			this.consentedAt = new Date().toISOString();
		}
	}

	clear(): void {
		this.citizenId = null;
		this.consented = false;
		this.consentedAt = null;
	}
}

export const walkInSession = new WalkInSession();
