import { describe, expect, it, vi } from 'vitest';
import { EVACUEE_QR_ISSUE_MAX_IDS, issueQrPayloads } from './evacuee-qr-issue';

const id = (n: number) =>
	`evacuee:${String(n).padStart(2, '0')}JC8ZQ4V6M2N5R7T9XBDEFG`.slice(0, 35);
const ULIDS = ['01JC8ZQ4V6M2N5R7T9XBDEFGH0', '01JC8ZQ4V6M2N5R7T9XBDEFGH1'].map(
	(u) => `evacuee:${u}`
);

describe('issueQrPayloads', () => {
	it('keeps only status issued items with a matching Person QR payload', async () => {
		const issue = vi.fn().mockResolvedValue([
			{ evacuee_id: ULIDS[0], status: 'issued', qr_payload: `${ULIDS[0]}@683508` },
			{ evacuee_id: ULIDS[1], status: 'not_found' }
		]);
		const result = await issueQrPayloads(
			{ shelterCode: 'SH001', source: 'profile', evacueeIds: ULIDS },
			{ issue }
		);
		expect([...result.payloads]).toEqual([[ULIDS[0], `${ULIDS[0]}@683508`]]);
		expect(result.failedIds).toEqual([ULIDS[1]]);
		expect(issue).toHaveBeenCalledWith({
			shelter_code: 'SH001',
			source: 'profile',
			evacuee_ids: ULIDS
		});
	});

	it('fails an issued item whose payload is missing or belongs to someone else', async () => {
		const issue = vi.fn().mockResolvedValue([
			{ evacuee_id: ULIDS[0], status: 'issued' },
			{ evacuee_id: ULIDS[1], status: 'issued', qr_payload: `${ULIDS[0]}@683508` }
		]);
		const result = await issueQrPayloads(
			{ shelterCode: 'SH001', source: 'family_batch', evacueeIds: ULIDS },
			{ issue }
		);
		expect(result.payloads.size).toBe(0);
		expect(result.failedIds).toEqual(ULIDS);
	});

	it('treats ids missing from the response as failed and dedupes input', async () => {
		const issue = vi.fn().mockResolvedValue([]);
		const result = await issueQrPayloads(
			{ shelterCode: 'SH001', source: 'profile', evacueeIds: [ULIDS[0], ULIDS[0]] },
			{ issue }
		);
		expect(result.failedIds).toEqual([ULIDS[0]]);
		expect(issue.mock.calls[0][0].evacuee_ids).toEqual([ULIDS[0]]);
	});

	it('splits requests above the contract limit of 30 ids', async () => {
		const ids = Array.from({ length: 31 }, (_, i) => id(i));
		const issue = vi.fn().mockResolvedValue([]);
		await issueQrPayloads(
			{ shelterCode: 'SH001', source: 'family_batch', evacueeIds: ids },
			{ issue }
		);
		expect(issue).toHaveBeenCalledTimes(2);
		expect(issue.mock.calls[0][0].evacuee_ids).toHaveLength(EVACUEE_QR_ISSUE_MAX_IDS);
	});

	it('rejects on network error (nothing is printable)', async () => {
		const issue = vi.fn().mockRejectedValue(new Error('offline'));
		await expect(
			issueQrPayloads({ shelterCode: 'SH001', source: 'profile', evacueeIds: ULIDS }, { issue })
		).rejects.toThrow('offline');
	});
});
