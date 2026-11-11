import { describe, expect, it } from 'vitest';
import { servedMealsOfDay } from './meal-coverage-served';

const TODAY = '2026-11-10';
const service = (id: string, meal: string, date = TODAY) => ({ _id: id, date, meal });
const receipt = (
	meal_service_id: string,
	outcome: 'confirmed' | 'rejected' | undefined,
	created_at = '2026-11-10T03:00:00Z'
) => ({ meal_service_id, outcome, created_at });

describe('servedMealsOfDay', () => {
	it('is empty when nothing was served today', () => {
		expect(servedMealsOfDay(TODAY, [], [])).toEqual([]);
		expect(servedMealsOfDay(TODAY, [service('ms:1', 'breakfast', '2026-11-09')], [])).toEqual([]);
	});

	it('counts a meal_service with no receipt yet as served', () => {
		expect(servedMealsOfDay(TODAY, [service('ms:1', 'breakfast')], [])).toEqual(['breakfast']);
	});

	it('counts a confirmed receipt and a legacy receipt with no outcome', () => {
		const services = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		const receipts = [receipt('ms:1', 'confirmed'), receipt('ms:2', undefined)];
		expect(servedMealsOfDay(TODAY, services, receipts)).toEqual(['breakfast', 'lunch']);
	});

	it('does not count a meal_service whose receipt rejected it', () => {
		const services = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		expect(servedMealsOfDay(TODAY, services, [receipt('ms:1', 'rejected')])).toEqual(['lunch']);
	});

	it('still counts the meal when another meal_service of it is not rejected', () => {
		const services = [service('ms:1', 'breakfast'), service('ms:2', 'breakfast')];
		expect(servedMealsOfDay(TODAY, services, [receipt('ms:1', 'rejected')])).toEqual(['breakfast']);
	});

	it('decides by the latest receipt of a meal_service', () => {
		const services = [service('ms:1', 'breakfast')];
		const rejectedThenConfirmed = [
			receipt('ms:1', 'rejected', '2026-11-10T03:00:00Z'),
			receipt('ms:1', 'confirmed', '2026-11-10T04:00:00Z')
		];
		expect(servedMealsOfDay(TODAY, services, rejectedThenConfirmed)).toEqual(['breakfast']);
		expect(servedMealsOfDay(TODAY, services, [...rejectedThenConfirmed].reverse())).toEqual([
			'breakfast'
		]);
		const confirmedThenRejected = [
			receipt('ms:1', 'confirmed', '2026-11-10T03:00:00Z'),
			receipt('ms:1', 'rejected', '2026-11-10T04:00:00Z')
		];
		expect(servedMealsOfDay(TODAY, services, confirmedThenRejected)).toEqual([]);
	});

	it('leaves out snack and returns meals in breakfast, lunch, dinner order', () => {
		const services = [
			service('ms:1', 'dinner'),
			service('ms:2', 'snack'),
			service('ms:3', 'breakfast')
		];
		expect(servedMealsOfDay(TODAY, services, [])).toEqual(['breakfast', 'dinner']);
	});
});
