/**
 * Shelter-scoped remote repository factories for Distribution domain entities.
 */

import { resolveShelterCode } from './shared';
import {
	RequisitionTicketRemoteRepository,
	DistributionLogRemoteRepository,
	BulkReturnPoolRemoteRepository,
	BulkReturnClaimRemoteRepository,
	type RequisitionTicketRepository,
	type DistributionLogRepository,
	type BulkReturnPoolRepository,
	type BulkReturnClaimRepository
} from '../../data/food-supplies';

export function requisitionTicketRepository(
	shelterCode: string = resolveShelterCode()
): RequisitionTicketRepository {
	return new RequisitionTicketRemoteRepository(shelterCode);
}

export function distributionLogRepository(
	shelterCode: string = resolveShelterCode()
): DistributionLogRepository {
	return new DistributionLogRemoteRepository(shelterCode);
}

export function bulkReturnPoolRepository(
	shelterCode: string = resolveShelterCode()
): BulkReturnPoolRepository {
	return new BulkReturnPoolRemoteRepository(shelterCode);
}

export function bulkReturnClaimRepository(
	shelterCode: string = resolveShelterCode()
): BulkReturnClaimRepository {
	return new BulkReturnClaimRemoteRepository(shelterCode);
}
