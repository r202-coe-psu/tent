import { describe, expect, it } from 'vitest';
import { shiftCloseGuide, shiftCloseStepState } from './shift-close-guide';

describe('shiftCloseGuide', () => {
	it('asks the desk to count and close while distributing', () => {
		expect(shiftCloseGuide('DISTRIBUTING')).toMatchObject({ current: 'close', deskActs: true });
	});

	it('asks the desk to submit returns once the shift is closed', () => {
		expect(shiftCloseGuide('SHIFT_CLOSED')).toMatchObject({ current: 'submit', deskActs: true });
	});

	it('waits on the warehouse after returns are submitted', () => {
		expect(shiftCloseGuide('RETURN_PENDING_RECEIPT')).toMatchObject({
			current: 'warehouse',
			deskActs: false
		});
	});

	it.each(['RETURN_COMPLETED', 'COMPLETED'] as const)('is done at %s', (status) => {
		expect(shiftCloseGuide(status)).toMatchObject({ current: 'done', deskActs: false });
	});
});

describe('shiftCloseStepState', () => {
	it('marks earlier steps done, the current one current and later ones todo', () => {
		expect(shiftCloseStepState('close', 'submit')).toBe('done');
		expect(shiftCloseStepState('submit', 'submit')).toBe('current');
		expect(shiftCloseStepState('warehouse', 'submit')).toBe('todo');
	});

	it('marks every step done when the ticket is finished', () => {
		expect(shiftCloseStepState('warehouse', 'done')).toBe('done');
	});
});
