import { describe, expect, it } from 'vitest';
import {
	boardShelters,
	controlledValuesFromMaster,
	filterFallbackJobs,
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
