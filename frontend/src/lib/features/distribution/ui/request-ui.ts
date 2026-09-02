import type {
	DistributionBatchStatus,
	DistributionRequest,
	DistributionRequestItem,
	DistributionRequestStatus
} from '../domain/distribution';

export type RequestStatusFilter = 'all' | DistributionRequestStatus;

export const distributionRequestStatusLabels: Record<DistributionRequestStatus, string> = {
	pending: 'รอดำเนินการ',
	approving: 'กำลังดำเนินการอนุมัติ',
	approved: 'อนุมัติแล้ว',
	rejected: 'ปฏิเสธ',
	cancelled: 'ยกเลิก'
};

export const distributionBatchStatusLabels: Record<DistributionBatchStatus, string> = {
	activating: 'กำลังประมวลผล',
	active: 'เปิดการแจกจ่าย (Active)',
	closing: 'กำลังปิด / กระทบยอด',
	closed: 'ปิดแล้ว (Closed)'
};

export const distributionRequestStatusOptions: Array<{
	value: RequestStatusFilter;
	label: string;
}> = [
	{ value: 'all', label: 'ทุกสถานะ' },
	...Object.entries(distributionRequestStatusLabels).map(([value, label]) => ({
		value: value as DistributionRequestStatus,
		label
	}))
];

export function summarizeDistributionRequests(requests: readonly DistributionRequest[]) {
	return {
		pending: requests.filter((request) => request.status === 'pending').length,
		approving: requests.filter((request) => request.status === 'approving').length,
		approved: requests.filter((request) => request.status === 'approved').length,
		closed: requests.filter(
			(request) => request.status === 'rejected' || request.status === 'cancelled'
		).length
	};
}

export function filterDistributionRequests(
	requests: readonly DistributionRequest[],
	search: string,
	status: RequestStatusFilter
): DistributionRequest[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();
	return requests.filter((request) => {
		if (status !== 'all' && request.status !== status) return false;
		if (!normalizedSearch) return true;
		return [request._id, request.purpose, request.requested_by]
			.join(' ')
			.toLocaleLowerCase()
			.includes(normalizedSearch);
	});
}

/**
 * Request item snapshots permit repeated item IDs. The position is part of the
 * persisted snapshot's presentation identity, so each historical row remains
 * independently renderable.
 */
export function getRequestItemPresentationKey(
	item: Pick<DistributionRequestItem, 'item_id'>,
	index: number
): string {
	return `${item.item_id}:${index}`;
}
