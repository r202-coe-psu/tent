import { describe, it, expect } from 'vitest';
import { generateTemporaryPassphrase, PASSPHRASE_WORDS } from './passphrase-generator';
import { validatePassword } from './password-policy';

describe('passphrase-generator', () => {
	it('has at least 100 memorable words in the pool', () => {
		expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(100);
		// All words should be non-empty strings with at least 3 letters
		for (const word of PASSPHRASE_WORDS) {
			expect(word.length).toBeGreaterThanOrEqual(3);
			expect(/^[A-Za-z]+$/.test(word)).toBe(true);
		}
	});

	it('generates a passphrase matching Word-Word-Digits! pattern', () => {
		const passphrase = generateTemporaryPassphrase();
		expect(passphrase).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{2,4}!$/);
	});

	it('generates passphrases that comply with the strict Password Policy', () => {
		for (let i = 0; i < 50; i++) {
			const passphrase = generateTemporaryPassphrase();
			expect(() => validatePassword(passphrase)).not.toThrow();
			expect(passphrase.length).toBeGreaterThanOrEqual(10);
			expect(/[A-Z]/.test(passphrase)).toBe(true);
			expect(/[a-z]/.test(passphrase)).toBe(true);
			expect(/[0-9]/.test(passphrase)).toBe(true);
			expect(/[^A-Za-z0-9]/.test(passphrase)).toBe(true);
		}
	});
});
