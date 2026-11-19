import { describe, expect, it } from 'vitest';
import { checkoutChannelOf } from './checkout-channel';

describe('checkoutChannelOf', () => {
	it.each([
		[
			'a kiosk self check-out',
			{ created_by: 'scanner:kiosk-sh001-01', reason: 'เช็คเอาต์ด้วยตนเอง' },
			'kiosk'
		],
		['the shelter closing', { created_by: 'system', reason: 'shelter_closed' }, 'shelter_closed'],
		['a closing backfill', { created_by: 'backfill', reason: 'shelter_closed' }, 'shelter_closed'],
		['a staff check-out', { created_by: 'user:somchai', reason: 'กลับบ้าน' }, 'staff'],
		['a staff check-out with no reason', { created_by: 'user:somchai' }, 'staff']
	])('classifies %s', (_label, movement, channel) => {
		expect(checkoutChannelOf(movement)).toBe(channel);
	});
});
