import { describe, expect, it } from 'vitest';
import { groupReferralsForList, referralBatchKey } from './referral.batch-group';
import type { Referral } from './referral.schema';

function makeReferral(
	overrides: Partial<Referral> & Pick<Referral, '_id' | 'evacuee_id'>
): Referral {
	return {
		type: 'referral',
		schema_v: 1,
		shelter_code: 'SHELTER-A',
		created_at: '2026-07-24T10:00:00.000Z',
		updated_at: '2026-07-24T10:00:00.000Z',
		created_by: 'user:ops',
		reason: 'เต็มความจุ',
		urgency: 'urgent',
		status: 'draft',
		timeline: {},
		referral_type: 'capacity',
		to_shelter_code: 'SHELTER-B',
		...overrides
	};
}

describe('referralBatchKey', () => {
	it('matches siblings created within the same time bucket', () => {
		const a = makeReferral({
			_id: 'referral:1',
			evacuee_id: 'evacuee:1',
			created_at: '2026-07-24T10:00:10.000Z'
		});
		const b = makeReferral({
			_id: 'referral:2',
			evacuee_id: 'evacuee:2',
			created_at: '2026-07-24T10:00:45.000Z'
		});
		expect(referralBatchKey(a)).toBe(referralBatchKey(b));
	});

	it('differs when reason or destination differs', () => {
		const a = makeReferral({ _id: 'referral:1', evacuee_id: 'evacuee:1' });
		const b = makeReferral({
			_id: 'referral:2',
			evacuee_id: 'evacuee:2',
			reason: 'เหตุผลอื่น'
		});
		expect(referralBatchKey(a)).not.toBe(referralBatchKey(b));
	});
});

describe('groupReferralsForList', () => {
	it('collapses a multi-person batch into one group', () => {
		const refs = [
			makeReferral({
				_id: 'referral:1',
				evacuee_id: 'evacuee:1',
				created_at: '2026-07-24T10:00:01.000Z'
			}),
			makeReferral({
				_id: 'referral:2',
				evacuee_id: 'evacuee:2',
				created_at: '2026-07-24T10:00:02.000Z'
			}),
			makeReferral({
				_id: 'referral:3',
				evacuee_id: 'evacuee:3',
				created_at: '2026-07-24T10:00:03.000Z',
				reason: 'คนละชุด'
			})
		];

		const groups = groupReferralsForList(refs);
		expect(groups).toHaveLength(2);
		const batch = groups.find((g) => g.count === 2);
		expect(batch).toBeDefined();
		expect(batch!.referrals.map((r) => r._id)).toEqual(['referral:2', 'referral:1']);
		expect(batch!.sharedStatus).toBe('draft');
	});

	it('marks sharedStatus null when member statuses diverge', () => {
		const refs = [
			makeReferral({
				_id: 'referral:1',
				evacuee_id: 'evacuee:1',
				status: 'sent'
			}),
			makeReferral({
				_id: 'referral:2',
				evacuee_id: 'evacuee:2',
				status: 'accepted',
				created_at: '2026-07-24T10:00:01.000Z'
			})
		];

		const [group] = groupReferralsForList(refs);
		expect(group!.count).toBe(2);
		expect(group!.sharedStatus).toBeNull();
	});
});
