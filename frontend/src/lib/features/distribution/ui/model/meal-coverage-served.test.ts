import { describe, expect, it } from 'vitest';
import type { MealPeriod } from '../../domain/food-supplies';
import { preparedPortionsOfDay, servedMealsOfDay } from './meal-coverage-served';

const TODAY = '2026-11-10';
const service = (id: string, meal: MealPeriod, date = TODAY) => ({ _id: id, date, meal });
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

describe('preparedPortionsOfDay', () => {
	const cooked = (
		id: string,
		meal: MealPeriod,
		portions: { actual_yield?: number | null; served?: number },
		date = TODAY
	) => ({ ...service(id, meal, date), ...portions });

	it('is null for a meal with no meal_service that day', () => {
		const services = [cooked('ms:1', 'breakfast', { actual_yield: 10 })];
		expect(preparedPortionsOfDay(TODAY, services, [])).toEqual({
			breakfast: 10,
			lunch: null,
			dinner: null
		});
		expect(preparedPortionsOfDay(TODAY, [], [])).toEqual({
			breakfast: null,
			lunch: null,
			dinner: null
		});
	});

	it('uses the recorded yield and falls back to served when there is none', () => {
		const services = [
			cooked('ms:1', 'breakfast', { actual_yield: 12, served: 9 }),
			cooked('ms:2', 'lunch', { actual_yield: null, served: 7 }),
			cooked('ms:3', 'dinner', { served: 5 })
		];
		expect(preparedPortionsOfDay(TODAY, services, [])).toEqual({
			breakfast: 12,
			lunch: 7,
			dinner: 5
		});
	});

	it('sums several meal_services of the same meal', () => {
		const services = [
			cooked('ms:1', 'lunch', { actual_yield: 10 }),
			cooked('ms:2', 'lunch', { served: 4 })
		];
		expect(preparedPortionsOfDay(TODAY, services, []).lunch).toBe(14);
	});

	it('leaves out rejected receipts, other days and snacks', () => {
		const services = [
			cooked('ms:1', 'breakfast', { actual_yield: 10 }),
			cooked('ms:2', 'breakfast', { actual_yield: 6 }),
			cooked('ms:3', 'lunch', { actual_yield: 8 }, '2026-11-09'),
			cooked('ms:4', 'snack', { actual_yield: 3 })
		];
		const result = preparedPortionsOfDay(TODAY, services, [receipt('ms:1', 'rejected')]);
		expect(result).toEqual({ breakfast: 6, lunch: null, dinner: null });
	});

	it('is null for a meal whose only meal_service was rejected', () => {
		const services = [cooked('ms:1', 'dinner', { actual_yield: 10 })];
		expect(preparedPortionsOfDay(TODAY, services, [receipt('ms:1', 'rejected')]).dinner).toBeNull();
	});
});
