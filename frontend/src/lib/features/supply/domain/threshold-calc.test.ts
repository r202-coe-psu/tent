import { describe, it, expect } from 'vitest';
import { calculateReorderLevel } from './threshold-calc';

describe('calculateReorderLevel', () => {
	it('should return null if consumption_rate is missing', () => {
		const result = calculateReorderLevel(100, {
			consumption_rate: undefined,
			target_reserve_days: 3,
			timeframe: 'daily'
		});
		expect(result).toBeNull();
	});

	it('should return null if target_reserve_days is missing', () => {
		const result = calculateReorderLevel(100, {
			consumption_rate: '0.5',
			target_reserve_days: undefined,
			timeframe: 'daily'
		});
		expect(result).toBeNull();
	});

	it('should calculate daily reorder level correctly', () => {
		// 100 people * 0.45 kg/day * 3 days = 135
		const result = calculateReorderLevel(100, {
			consumption_rate: '0.45',
			target_reserve_days: 3,
			timeframe: 'daily'
		});
		expect(result).toBe('135');
	});

	it('should calculate weekly reorder level correctly by dividing by 7', () => {
		// 70 people * 7 kg/week * 3 days = 1470 kg/week * 3 days = 490 kg/day * 3 = 1470?
		// Formula: (70 * 7 * 3) / 7 = 210
		const result = calculateReorderLevel(70, {
			consumption_rate: '7',
			target_reserve_days: 3,
			timeframe: 'weekly'
		});
		expect(result).toBe('210');
	});

	it('should handle decimal precision safely without floating point noise', () => {
		// 123 people * 0.12345 kg/day * 5 days = 75.92175 -> rounded to 4 decimals = 75.9218
		const result = calculateReorderLevel(123, {
			consumption_rate: '0.12345',
			target_reserve_days: 5,
			timeframe: 'daily'
		});
		expect(result).toBe('75.9218');
	});
});
