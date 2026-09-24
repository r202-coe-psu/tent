import { describe, expect, it } from 'vitest';
import { generateTemporaryPassphrase, PASSPHRASE_WORDS } from './passphrase-generator';
import { validatePassword, validateProvisionedPassword } from './password-policy';

describe('passphrase-generator (server re-export)', () => {
	it('exports the shared word list', () => {
		expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(100);
	});

	it('generates passphrases that comply with the server Password Policy', () => {
		for (let i = 0; i < 20; i++) {
			const passphrase = generateTemporaryPassphrase();
			expect(() => validatePassword(passphrase)).not.toThrow();
		}
	});
});

describe('validateProvisionedPassword', () => {
	it('allows a volunteer phone only as a forced first-login password', () => {
		expect(
			validateProvisionedPassword('0812345678', {
				phone: '0812345678',
				personnelType: 'volunteer',
				mustChangePassword: true
			})
		).toBe('0812345678');
		expect(() =>
			validateProvisionedPassword('0812345678', {
				phone: '0812345678',
				personnelType: 'staff',
				mustChangePassword: false
			})
		).toThrow();
	});
});
