/** Badge colours per shelter status on the public `/shelters` page and its cards. */
export function shelterStatusClass(status: string): string {
	switch (status) {
		case 'OPEN':
			return 'bg-transparent text-success border-border/80';
		case 'FULL':
			return 'bg-transparent text-danger border-border/80';
		case 'PREPARE':
			return 'bg-transparent text-warning border-border/80';
		case 'UNKNOWN':
			// CR-252 FR-20: Slate/Neutral, distinct from the yellow of standby
			return 'border-slate-300 bg-slate-100 text-slate-700';
		default:
			return 'bg-transparent text-muted-foreground border-border/80';
	}
}

export type ShelterStatusLabels = {
	statusOpen: string;
	statusFull: string;
	statusPrepare: string;
	statusUnknown: string;
	statusClosed: string;
};

/** The status as the reader sees it; anything unrecognised reads as closed. */
export function shelterStatusLabel(status: string, labels: ShelterStatusLabels): string {
	switch (status) {
		case 'OPEN':
			return labels.statusOpen;
		case 'FULL':
			return labels.statusFull;
		case 'PREPARE':
			return labels.statusPrepare;
		case 'UNKNOWN':
			return labels.statusUnknown;
		default:
			return labels.statusClosed;
	}
}
