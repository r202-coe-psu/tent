import { describe, expect, it } from 'vitest';
import {
	boardShelters,
	controlledValuesFromMaster,
	filterFallbackJobs,
	skillCodesByLabel,
	summarizeFallbackJobs,
	type FallbackJob
} from './public-board-fallback';

const NOW = new Date('2026-11-23T03:00:00.000Z'); // 10:00 Bangkok

const job = (id: string, extra: Partial<FallbackJob> = {}): FallbackJob => ({
	_id: id,
	title: id,
	shelter_code: 'SH001',
	slots_remaining: 5,
	...extra
});
const ended = { date: '2020-01-01', start_time: '08:00', end_time: '12:00', slots_remaining: 5 };
const future = { date: '2099-01-01', start_time: '08:00', end_time: '12:00', slots_remaining: 5 };

const base = {
	q: '',
	skills: [] as string[],
	shelterNames: new Map<string, string>(),
	controlled: new Set<string>(),
	now: NOW
};

describe('filterFallbackJobs — same rules as FastAPI (#1470 review W3)', () => {
	it('matches q against the shelter name too, not only its code', () => {
		const jobs = [job('job:a', { shelter_code: 'SH001' }), job('job:b', { shelter_code: 'SH002' })];
		const shelterNames = new Map([
			['SH001', 'โรงเรียนบ้านพรุ'],
			['SH002', 'วัดคอหงส์']
		]);
		const { jobs: hit } = filterFallbackJobs(jobs, { ...base, q: 'คอหงส์', shelterNames });
		expect(hit.map((j) => j._id)).toEqual(['job:b']);
	});

	it('counts a job as controlled by its tier OR a controlled skill (code or label)', () => {
		const jobs = [
			job('job:tier', { tier: 'staff-capable' }),
			job('job:skill', { skills_required: ['nurse'] }),
			job('job:label', { skills_required: ['พยาบาล'] }),
			job('job:plain', { skills_required: ['cooking'] })
		];
		const controlled = new Set(['nurse', 'พยาบาล']);
		const { jobs: hit } = filterFallbackJobs(jobs, { ...base, status: 'controlled', controlled });
		expect(hit.map((j) => j._id).sort()).toEqual(['job:label', 'job:skill', 'job:tier']);
	});

	it('sorts open jobs first, then by shelter code, title and id (FR-5, CR-215 FR-4)', () => {
		const jobs = [
			job('job:3', { shelter_code: 'SH002', title: 'ก' }),
			job('job:1', { shelter_code: 'SH001', title: 'ข', shifts: [ended] }),
			job('job:2', { shelter_code: 'SH001', title: 'ค', shifts: [future] }),
			job('job:4', { shelter_code: 'SH001', title: 'ก' })
		];
		const { jobs: sorted } = filterFallbackJobs(jobs, base);
		expect(sorted.map((j) => j._id)).toEqual(['job:4', 'job:2', 'job:3', 'job:1']);
	});

	it('cuts the page after sorting, so an ended job never takes an open one’s place', () => {
		const jobs = [
			job('job:ended', { title: 'ก', shifts: [ended] }),
			job('job:open', { title: 'ข', shifts: [future] })
		];
		const { jobs: first, total } = filterFallbackJobs(jobs, { ...base, page: 1, pageSize: 1 });
		expect(first.map((j) => j._id)).toEqual(['job:open']);
		expect(total).toBe(2);
	});
});

describe('filterFallbackJobs — remaining seats (#1470 review B1, CR-264 FR-3)', () => {
	// A Couch job doc keeps only `quota` on a fresh shift — no `slots_remaining` yet.
	const fresh = { date: '2099-01-01', start_time: '08:00', end_time: '12:00', quota: 10 };

	it('keeps a new job whose shifts only carry a quota under status=open', () => {
		const jobs = [job('job:new', { slots_remaining: undefined, shifts: [fresh] })];
		expect(filterFallbackJobs(jobs, { ...base, status: 'open' }).jobs).toHaveLength(1);
	});

	it('derives remaining as quota − confirmed − dispatched, so a full shift is not open', () => {
		const full = { ...fresh, quota: 4, slots_confirmed: 3, slots_dispatched: 1 };
		const almost = { ...fresh, quota: 4, slots_confirmed: 3, slots_dispatched: 0 };
		const jobs = [
			job('job:full', { slots_remaining: undefined, shifts: [full] }),
			job('job:almost', { slots_remaining: undefined, shifts: [almost] })
		];
		expect(filterFallbackJobs(jobs, { ...base, status: 'open' }).jobs.map((j) => j._id)).toEqual([
			'job:almost'
		]);
		expect(
			filterFallbackJobs(jobs, { ...base, status: 'near_full' }).jobs.map((j) => j._id)
		).toEqual(['job:almost']);
	});

	it('does not count an ended shift’s seats toward open / near_full (D2)', () => {
		const jobs = [job('job:ended', { shifts: [ended] }), job('job:live', { shifts: [future] })];
		expect(filterFallbackJobs(jobs, { ...base, status: 'open' }).jobs.map((j) => j._id)).toEqual([
			'job:live'
		]);
	});
});

describe('controlledValuesFromMaster', () => {
	it('takes the code and both labels of each active controlled item, lower-cased', () => {
		const values = controlledValuesFromMaster([
			{ code: 'nurse', label_th: 'พยาบาล', label_en: 'Nurse', category: 'controlled' },
			{
				code: 'old',
				label_th: 'เก่า',
				label_en: 'Old',
				category: 'controlled',
				status: 'inactive'
			},
			{ code: 'cook', label_th: 'ทำอาหาร', label_en: 'Cook', category: 'general' }
		]);
		expect(values).toEqual(new Set(['nurse', 'พยาบาล']));
	});

	it('falls back to the built-in floor when Master Data has no controlled skill', () => {
		expect(controlledValuesFromMaster([]).size).toBeGreaterThan(0);
	});
});

describe('boardShelters', () => {
	it('lists only shelters that have a board job, by code, whatever the filters', () => {
		const shelters = [
			{ code: 'SH003', name: 'C', db: 'shelter_sh003' },
			{ code: 'SH001', name: 'A', db: 'shelter_sh001' },
			{ code: 'SH002', name: 'B', db: 'shelter_sh002' }
		];
		const jobs = [job('j1', { shelter_code: 'SH003' }), job('j2', { shelter_code: 'sh001' })];
		expect(boardShelters(shelters, jobs)).toEqual([
			{ code: 'SH001', name: 'A' },
			{ code: 'SH003', name: 'C' }
		]);
	});
});

describe('skill label search and summary (CR-264 D3, FR-9)', () => {
	it('finds a job by the display name of its skill code', () => {
		const items = [
			{ code: 'cooking', label_th: 'ทำอาหาร', label_en: 'Cooking' },
			{ code: 'driving', label_th: 'ขับรถ' }
		];
		const jobs = [
			job('job:k', { skills_required: ['cooking'] }),
			job('job:d', { skills_required: ['driving'] })
		];
		const hit = filterFallbackJobs(jobs, {
			...base,
			q: 'cook',
			skillCodesByLabel: skillCodesByLabel(items, 'cook')
		});
		expect(hit.jobs.map((j) => j._id)).toEqual(['job:k']);
	});

	it('counts the whole board, ignoring filters', () => {
		const jobs = [
			job('job:a', { slots_remaining: 5 }),
			job('job:b', { slots_remaining: 2 }),
			job('job:c', { slots_remaining: 0, tier: 'staff-capable' })
		];
		expect(summarizeFallbackJobs(jobs, new Set(), NOW)).toEqual({
			total: 3,
			open: 2,
			near_full: 1,
			controlled: 1
		});
	});
});
