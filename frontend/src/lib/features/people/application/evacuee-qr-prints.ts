import { createQuery } from '@tanstack/svelte-query';
import { readEvacueeQrPrints } from '../data/evacuee-qr.remote';
import { peopleKeys } from './queries';

/**
 * The `evacuee_qr.prints[]` log of one evacuee (#1301). Refreshed by `issueQrPayloads` when a QR
 * card is printed, so the stale-card warning disappears after a reprint.
 */
export const useEvacueeQrPrints = (evacueeId: () => string) =>
	createQuery(() => ({
		queryKey: peopleKeys.evacueeQrPrints(evacueeId()),
		queryFn: () => readEvacueeQrPrints(evacueeId()),
		enabled: !!evacueeId()
	}));
