import { describe, expect, it } from 'vitest';
import type { DistributionRequest } from '../domain/distribution';
import {
	distributionBatchStatusLabels,
	distributionRequestStatusLabels,
	filterDistributionRequests,
	approvalCoverageLabels,
	getRequestItemPresentationKey,
	requestSortOptions,
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

	it('filters only by real request fields, statuses, and derived coverage', () => {
		const fullReq = requests[2];
		const partialReq = {
			...requests[2],
			_id: 'distribution_request:partial'
		};
		const unknownReq = {
			...requests[2],
			_id: 'distribution_request:unknown'
		};
		const allRequests = [...requests, partialReq, unknownReq];
		const coverageMap = new Map<string, 'full' | 'partial' | 'none' | 'unknown'>([
			[fullReq._id, 'full'],
			[partialReq._id, 'partial'],
			[unknownReq._id, 'unknown']
		]);

		expect(filterDistributionRequests(requests, 'registration_a', 'all')).toEqual([requests[0]]);
		expect(filterDistributionRequests(requests, 'ผ้า', 'approving')).toEqual([requests[1]]);
		expect(filterDistributionRequests(requests, 'ไม่พบ', 'all')).toEqual([]);
		expect(filterDistributionRequests(allRequests, '', 'approved', 'partial', coverageMap)).toEqual(
			[partialReq]
		);
		expect(filterDistributionRequests(allRequests, '', 'approved', 'full', coverageMap)).toEqual([
			fullReq
		]);
		// Unknown coverage requests are excluded from both full and partial filters
		expect(filterDistributionRequests([unknownReq], '', 'approved', 'full', coverageMap)).toEqual(
			[]
		);
		expect(
			filterDistributionRequests([unknownReq], '', 'approved', 'partial', coverageMap)
		).toEqual([]);
	});

	it('provides labels for approval coverage', () => {
		expect(approvalCoverageLabels).toEqual({
			full: 'จัดสรรครบจำนวน',
			partial: 'จัดสรรบางส่วน'
		});
	});

	it('provides display labels for every persisted request status', () => {
		expect(distributionRequestStatusLabels).toEqual({
			pending: 'รอดำเนินการ',
			approving: 'กำลังยืนยันการจัดสรร',
			approved: 'อนุมัติการจัดสรรแล้ว',
			rejected: 'ปฏิเสธ',
			cancelled: 'ยกเลิก'
		});
	});

	it('provides display labels for every persisted batch status', () => {
		expect(distributionBatchStatusLabels).toEqual({
			activating: 'กำลังประมวลผล',
			active: 'เปิดการแจกจ่าย (Active)',
			closing: 'กำลังปิด / กระทบยอด',
			closed: 'ปิดแล้ว (Closed)'
		});
	});

	it('gives duplicate item snapshots independent presentation identities', () => {
		const rows = [{ item_id: 'item:water' }, { item_id: 'item:water' }];
		const keys = rows.map(getRequestItemPresentationKey);

		expect(keys).toEqual(['item:water:0', 'item:water:1']);
		expect(new Set(keys)).toHaveLength(2);
	});

	it('provides options for sorting by time', () => {
		expect(requestSortOptions).toEqual([
			{ value: 'newest', label: 'เวลา: ใหม่ไปเก่า' },
			{ value: 'oldest', label: 'เวลา: เก่าไปใหม่' }
		]);
	});

	it('sorts requests by requested_at/created_at timestamp', () => {
		const r1 = {
			...request('pending', 'คำร้อง 1'),
			requested_at: '2026-09-01T08:00:00.000Z'
		};
		const r2 = {
			...request('pending', 'คำร้อง 2'),
			requested_at: '2026-09-02T12:00:00.000Z'
		};
		const r3 = {
			...request('pending', 'คำร้อง 3'),
			requested_at: '2026-08-30T10:00:00.000Z'
		};
		const list = [r1, r2, r3];

		const sortedNewest = filterDistributionRequests(list, '', 'all', 'all', undefined, 'newest');
		expect(sortedNewest.map((r) => r.purpose)).toEqual(['คำร้อง 2', 'คำร้อง 1', 'คำร้อง 3']);

		const sortedOldest = filterDistributionRequests(list, '', 'all', 'all', undefined, 'oldest');
		expect(sortedOldest.map((r) => r.purpose)).toEqual(['คำร้อง 3', 'คำร้อง 1', 'คำร้อง 2']);
	});
});
