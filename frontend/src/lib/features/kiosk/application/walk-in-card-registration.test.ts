import { describe, expect, it, vi } from 'vitest';
import { registerWalkInCardRead } from './walk-in-card-registration';

const session = {
	citizenId: '1234567890123',
	consented: true,
	consentedAt: new Date().toISOString()
};
const card = { citizen_id: '1234567890123' } as never;

describe('registerWalkInCardRead', () => {
	it('rejects a different card without submitting it', async () => {
		const register = vi.fn();

		await expect(
			registerWalkInCardRead({ citizen_id: '9999999999999' } as never, session, register)
		).resolves.toMatchObject({ kind: 'mismatch' });
		expect(register).not.toHaveBeenCalled();
	});

	it('allows retry after registration failure', async () => {
		const register = vi
			.fn()
			.mockRejectedValueOnce(new Error('บริการไม่พร้อมใช้งาน'))
			.mockResolvedValueOnce({ evacuee_id: 'evacuee:01' });

		await expect(registerWalkInCardRead(card, session, register)).resolves.toMatchObject({
			kind: 'error',
			message: 'บริการไม่พร้อมใช้งาน'
		});
		await expect(registerWalkInCardRead(card, session, register)).resolves.toEqual({
			kind: 'registered'
		});
		expect(register).toHaveBeenCalledTimes(2);
	});
});
