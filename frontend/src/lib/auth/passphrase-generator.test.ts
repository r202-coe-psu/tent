import { describe, it, expect } from 'vitest';
import { generateTemporaryPassphrase, PASSPHRASE_WORDS } from './passphrase-generator';
import { passwordSchema } from './password-schema';

describe('passphrase-generator', () => {
	it('has at least 100 memorable words in the pool', () => {
		expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(100);
		for (const word of PASSPHRASE_WORDS) {
			expect(word.length).toBeGreaterThanOrEqual(3);
			expect(/^[A-Za-z]+$/.test(word)).toBe(true);
		}
	});

	it('generates a passphrase matching Word-Word-Digits! pattern', () => {
		const passphrase = generateTemporaryPassphrase();
		expect(passphrase).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{2,4}!$/);
	});

	it('generates passphrases that comply with the client password schema', () => {
		for (let i = 0; i < 50; i++) {
			const passphrase = generateTemporaryPassphrase();
			expect(passwordSchema.safeParse(passphrase).success).toBe(true);
		}
	});
});
