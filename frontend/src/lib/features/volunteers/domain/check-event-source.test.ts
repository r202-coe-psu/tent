import { describe, it, expect } from 'vitest';
import { describeCheckEvent } from './check-event-source';

const base = { volunteerName: 'คีตศิลป์ คงสี' };

describe('describeCheckEvent', () => {
	describe.each(['check_in', 'check_out'] as const)('%s', (kind) => {
		const isIn = kind === 'check_in';

		it('portal → volunteer acted themselves', () => {
			const d = describeCheckEvent({ ...base, kind, method: 'portal' });
			expect(d.source).toBe('self');
			expect(d.group).toBe('self');
			expect(d.sourceLabel).toBe(isIn ? 'จิตอาสาเช็คอินเอง' : 'จิตอาสาเช็คเอาต์เอง');
			expect(d.actorLine).toBe(
				isIn ? 'คีตศิลป์ คงสี (เช็คอินด้วยตนเอง)' : 'คีตศิลป์ คงสี (เช็คเอาต์ด้วยตนเอง)'
			);
		});

		it('qr → staff member (by) scanned, never the volunteer', () => {
			const d = describeCheckEvent({ ...base, kind, method: 'qr', by: 'Sh001-VC-001' });
			expect(d.source).toBe('staff_qr');
			expect(d.group).toBe('staff');
			expect(d.actorLine).toBe('Sh001-VC-001 (สแกน QR)');
			expect(d.actorLine).not.toContain('คีตศิลป์');
			expect(d.sourceLabel).toContain('สแกน QR');
		});

		it('manual_override → staff + reason', () => {
			const d = describeCheckEvent({
				...base,
				kind,
				method: 'manual_override',
				by: 'Sh001-VC-001',
				reason: 'QR เสีย'
			});
			expect(d.source).toBe('staff_manual');
			expect(d.group).toBe('staff');
			expect(d.actorLine).toContain('Sh001-VC-001');
			expect(d.noteLine).toBe('QR เสีย');
		});

		it('manual_override without reason falls back to a dash', () => {
			const d = describeCheckEvent({ ...base, kind, method: 'manual_override', by: 'x' });
			expect(d.noteLine).toBe('—');
		});

		it('qr / manual_override without by → generic staff label, not the volunteer', () => {
			expect(describeCheckEvent({ ...base, kind, method: 'qr' }).actorLine).toBe('จนท. (สแกน QR)');
			expect(describeCheckEvent({ ...base, kind, method: 'manual_override' }).actorLine).toContain(
				'จนท.'
			);
		});

		it('portal never shows the volunteer_portal system marker', () => {
			const d = describeCheckEvent({ ...base, kind, method: 'portal', by: 'volunteer_portal' });
			expect(d.actorLine).not.toContain('volunteer_portal');
			expect(d.actorLine).toContain('คีตศิลป์ คงสี');
		});

		it('legacy: no method → unknown, no guessing', () => {
			for (const method of [undefined, null]) {
				const d = describeCheckEvent({ ...base, kind, method });
				expect(d.source).toBe('unknown');
				expect(d.group).toBe('unknown');
				expect(d.sourceLabel).toBe('ไม่ระบุ');
				expect(d.actorLine).toBe('ไม่ระบุ');
			}
		});

		it('legacy: no method but by present → shows by', () => {
			expect(describeCheckEvent({ ...base, kind, by: 'Sh001-VC-001' }).actorLine).toBe(
				'Sh001-VC-001'
			);
		});

		it('blank by is treated as missing', () => {
			expect(describeCheckEvent({ ...base, kind, method: 'qr', by: '  ' }).actorLine).toBe(
				'จนท. (สแกน QR)'
			);
		});
	});
});
