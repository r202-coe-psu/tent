import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001'
}));

import { getEvacueeSelectionError } from './referral.ui-helpers';

describe('getEvacueeSelectionError', () => {
	it('returns the Thai required-selection message when no evacuee is selected', () => {
		expect(getEvacueeSelectionError([])).toBe('กรุณาเลือกผู้ประสบภัยอย่างน้อย 1 คน');
	});

	it('returns undefined when at least one evacuee is selected', () => {
		expect(getEvacueeSelectionError(['evacuee:01A'])).toBeUndefined();
		expect(getEvacueeSelectionError(['evacuee:01A', 'evacuee:01B'])).toBeUndefined();
	});
});
