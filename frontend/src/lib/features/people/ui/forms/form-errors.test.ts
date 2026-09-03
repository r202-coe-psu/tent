import { describe, expect, it } from 'vitest';
import { collectFormErrorMessages } from './form-errors';

describe('collectFormErrorMessages', () => {
	it('flattens nested superforms errors uniquely', () => {
		expect(
			collectFormErrorMessages({
				first_name: ['กรุณากรอกชื่อ'],
				emergency_contact: {
					phone: ['กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก'],
					name: ['กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน']
				},
				_errors: ['กรุณากรอกชื่อ']
			})
		).toEqual([
			'กรุณากรอกชื่อ',
			'กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก',
			'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน'
		]);
	});

	it('returns empty for nullish input', () => {
		expect(collectFormErrorMessages(null)).toEqual([]);
		expect(collectFormErrorMessages(undefined)).toEqual([]);
	});
});
