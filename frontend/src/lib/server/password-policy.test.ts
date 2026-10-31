import { describe, expect, it } from 'vitest';
import { validatePassword } from './password-policy';

describe('validatePassword (#1045)', () => {
	it('rejects a weak password with the Thai policy message', () => {
		expect(() => validatePassword('abc')).toThrow(/^รหัสผ่านต้องมี: อย่างน้อย 10 ตัวอักษร/);
	});

	it('returns the trimmed password when it passes', () => {
		expect(validatePassword('  Shelter-2569x  ')).toBe('Shelter-2569x');
	});
});
