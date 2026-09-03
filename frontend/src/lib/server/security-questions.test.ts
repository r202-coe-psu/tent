import { describe, it, expect } from 'vitest';
import {
	hashSecurityAnswer,
	verifySecurityAnswer,
	normalizeSecurityAnswer,
	getSecurityQuestionLabel,
	SECURITY_QUESTIONS
} from './security-questions';

describe('security-questions', () => {
	it('contains 6 standard questions', () => {
		expect(SECURITY_QUESTIONS).toHaveLength(6);
		expect(SECURITY_QUESTIONS.map((q) => q.id)).toEqual([
			'high_school',
			'birth_province',
			'first_pet',
			'primary_school',
			'favorite_teacher',
			'first_workplace'
		]);
	});

	it('returns the correct label for a valid question id', () => {
		expect(getSecurityQuestionLabel('high_school')).toBe('โรงเรียนมัธยมที่คุณเคยศึกษาคือที่ใด?');
		expect(getSecurityQuestionLabel('unknown_id')).toBeNull();
	});

	it('normalizes answers by trimming and lowercasing', () => {
		expect(normalizeSecurityAnswer('  Bangkok ')).toBe('bangkok');
		expect(normalizeSecurityAnswer(' โรงเรียนสวนกุหลาบ ')).toBe('โรงเรียนสวนกุหลาบ');
	});

	it('hashes and verifies answers with salt correctly', () => {
		const rawAnswer = 'สวนกุหลาบวิทยาลัย';
		const { answer_hash, salt } = hashSecurityAnswer(rawAnswer);

		expect(salt).toBeDefined();
		expect(salt.length).toBeGreaterThanOrEqual(16);
		expect(answer_hash).toBeDefined();
		expect(answer_hash.length).toBe(64); // SHA-256 hex string

		// Correct answer matches
		expect(verifySecurityAnswer('สวนกุหลาบวิทยาลัย', salt, answer_hash)).toBe(true);
		expect(verifySecurityAnswer(' สวนกุหลาบวิทยาลัย  ', salt, answer_hash)).toBe(true);

		// Wrong answer does not match
		expect(verifySecurityAnswer('เทพศิรินทร์', salt, answer_hash)).toBe(false);
	});
});
