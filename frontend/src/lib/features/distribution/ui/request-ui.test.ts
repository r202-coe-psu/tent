import { describe, expect, it } from 'vitest';
import type { DistributionRequest } from '../domain/distribution';
import {
	distributionRequestStatusLabels,
	filterDistributionRequests,
	summarizeDistributionRequests
} from './request-ui';

const request = (status: DistributionRequest['status'], purpose: string, requestedBy = 'staff') =>
	({
		_id: `distribution_request:${status}:${purpose}`,
		status,
		purpose,
		requested_by: requestedBy
	}) as DistributionRequest;

describe('Distribution request UI helpers', () => {
	const requests = [
		request('pending', 'น้ำดื่ม', 'registration_a'),
		request('approving', 'ผ้าห่ม'),
		request('approved', 'ชุดสุขอนามัย'),
		request('rejected', 'เสื่อ'),
		request('cancelled', 'ไฟฉาย')
	];

	it('derives the four real status summary groups', () => {
		expect(summarizeDistributionRequests(requests)).toEqual({
			pending: 1,
			approving: 1,
			approved: 1,
			closed: 2
		});
	});

	it('filters only by real request fields and statuses', () => {
		expect(filterDistributionRequests(requests, 'registration_a', 'all')).toEqual([requests[0]]);
		expect(filterDistributionRequests(requests, 'ผ้า', 'approving')).toEqual([requests[1]]);
		expect(filterDistributionRequests(requests, 'ไม่พบ', 'all')).toEqual([]);
	});

	it('provides display labels for every persisted request status', () => {
		expect(distributionRequestStatusLabels).toEqual({
			pending: 'รอดำเนินการ',
			approving: 'กำลังดำเนินการอนุมัติ',
			approved: 'อนุมัติแล้ว',
			rejected: 'ปฏิเสธ',
			cancelled: 'ยกเลิก'
		});
	});
});
