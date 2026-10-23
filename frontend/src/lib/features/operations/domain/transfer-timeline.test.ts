import { describe, expect, it } from 'vitest';
import { transferTimelineSteps } from './transfer-timeline';

const ev = (at: string) => ({ at, by: 'สมชาย' });

describe('transferTimelineSteps', () => {
	it('orders steps by time', () => {
		const steps = transferTimelineSteps({
			status: 'received',
			updated_at: '2026-01-04T00:00:00.000Z',
			timeline: {
				requested: ev('2026-01-01T00:00:00.000Z'),
				disputed: ev('2026-01-02T00:00:00.000Z'),
				shipped: ev('2026-01-03T00:00:00.000Z'),
				received: ev('2026-01-04T00:00:00.000Z')
			}
		});
		expect(steps.map((s) => s.key)).toEqual(['requested', 'disputed', 'shipped', 'received']);
		expect(steps[0]).toMatchObject({ label: 'สร้างคำขอ', by: 'สมชาย' });
	});

	it('omits steps that never happened', () => {
		const steps = transferTimelineSteps({
			status: 'requested',
			updated_at: '2026-01-01T00:00:00.000Z',
			timeline: { requested: ev('2026-01-01T00:00:00.000Z') }
		});
		expect(steps.map((s) => s.key)).toEqual(['requested']);
	});

	it('appends cancelled using updated_at without an actor', () => {
		const steps = transferTimelineSteps({
			status: 'cancelled',
			updated_at: '2026-01-05T00:00:00.000Z',
			timeline: { requested: ev('2026-01-01T00:00:00.000Z') }
		});
		expect(steps.at(-1)).toEqual({
			key: 'cancelled',
			label: 'ยกเลิก',
			at: '2026-01-05T00:00:00.000Z'
		});
	});
});
