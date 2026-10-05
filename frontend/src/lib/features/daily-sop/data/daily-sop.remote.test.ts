import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '$lib/utils/errors';
import {
	DAILY_SOP_ROLES,
	createEmptyRoleDraft,
	dailySopRoleAssessmentSchema,
	metricForQuestion,
	promptForQuestion,
	questionsForRole,
	roleDraftFromAssessment,
	type DailySopRoleAssessment,
	type DailySopRoleCode
} from '../domain/daily-sop';
import {
	buildDailySopRoleId,
	DAILY_SOP_ROLE_PAGE_SIZE,
	DailySopRoleRemoteRepository,
	fetchDailySopStockStatus
} from './daily-sop.remote';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';

const ctx = {
	shelterCode: 'SH001',
	createdBy: 'fac01',
	assessorName: 'ผู้ตรวจสถานที่',
	roles: ['SH001:facility_staff'],
	sopRatios: validRatios
};

vi.mock('$lib/db/couch-db', () => ({
	findDocsPage: vi.fn(),
	getDoc: vi.fn(),
	putDocStrict: vi.fn()
}));

function previousDate(daysAgo: number): string {
	const value = new Date('2026-09-25T00:00:00.000Z');
	value.setUTCDate(value.getUTCDate() - daysAgo);
	return value.toISOString().slice(0, 10);
}

function validAssessment(roleCode: DailySopRoleCode, date: string): DailySopRoleAssessment {
	const role = DAILY_SOP_ROLES.find((item) => item.code === roleCode)!;
	const timestamp = `${date}T10:00:00.000Z`;
	const controls = questionsForRole(roleCode).map((question) => {
		const metric = metricForQuestion(question.id, validRatios);
		return {
			id: question.id,
			question: promptForQuestion(question, validRatios),
			metric_spec: metric
				? {
						fields: metric.fields,
						threshold: metric.threshold,
						...(metric.parameter ? { parameter: metric.parameter } : {})
					}
				: null,
			status: null,
			notes: '',
			observations: '',
			measured_values: metric
				? Object.fromEntries(metric.fields.map((item) => [item.key, null]))
				: {},
			checked_by: 'fac01',
			checked_by_name: 'ผู้ตรวจสถานที่',
			checked_at: timestamp
		};
	});
	return dailySopRoleAssessmentSchema.parse({
		_id: buildDailySopRoleId('SH001', date, roleCode),
		type: 'daily_sop_role_assessment',
		schema_v: 1,
		shelter_code: 'SH001',
		assessment_date: date,
		role_code: roleCode,
		role_key: role.key,
		role_label: role.label,
		question_set_version: 'daily-sop-role-v1',
		assessed_at: timestamp,
		assessor_name: 'ผู้ตรวจสถานที่',
		status: 'InProgress',
		pass_count: 0,
		fail_count: 0,
		pending_count: 0,
		unanswered_count: controls.length,
		controls,
		created_at: timestamp,
		updated_at: timestamp,
		created_by: 'fac01',
		_rev: '1-test'
	});
}

function completeFacilityDraft() {
	const draft = createEmptyRoleDraft('FAC');
	for (const question of questionsForRole('FAC')) draft[question.id].status = 'Pass';
	return draft;
}

describe('Daily SOP role repository', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
		const couch = await import('$lib/db/couch-db');
		vi.mocked(couch.findDocsPage).mockResolvedValue({ docs: [], bookmark: null });
		vi.mocked(couch.getDoc).mockResolvedValue(null);
		vi.mocked(couch.putDocStrict).mockImplementation(async (_db, doc) => ({
			...doc,
			_rev: '1-created'
		}));
	});

	it('builds one deterministic assessment id for each shelter, day, and role', () => {
		expect(buildDailySopRoleId('SH001', '2026-09-25', 'FAC')).toBe(
			'daily_sop_role_assessment:SH001:2026-09-25:FAC'
		);
	});

	it('queries the registered Mango index with the same filters and CouchDB bookmark on every page', async () => {
		const couch = await import('$lib/db/couch-db');
		const docs = Array.from({ length: DAILY_SOP_ROLE_PAGE_SIZE }, (_, index) =>
			validAssessment('FAC', previousDate(index + 1))
		);
		vi.mocked(couch.findDocsPage)
			.mockResolvedValueOnce({ docs, bookmark: 'bookmark-page-1' })
			.mockResolvedValueOnce({
				docs: [validAssessment('REG', previousDate(101))],
				bookmark: 'bookmark-page-2'
			})
			.mockResolvedValueOnce({ docs: [], bookmark: 'bookmark-page-2' });
		const repo = new DailySopRoleRemoteRepository('shelter_sh001');

		const first = await repo.listPage('SH001');
		expect(first.items).toHaveLength(DAILY_SOP_ROLE_PAGE_SIZE);
		expect(first.bookmark).toBe('bookmark-page-1');
		const firstQuery = vi.mocked(couch.findDocsPage).mock.calls[0][1];
		expect(firstQuery).toMatchObject({
			selector: {
				type: 'daily_sop_role_assessment',
				shelter_code: 'SH001',
				assessment_date: { $lte: '2026-09-25' }
			},
			sort: [
				{ type: 'desc' },
				{ shelter_code: 'desc' },
				{ assessment_date: 'desc' },
				{ role_code: 'desc' }
			],
			use_index: ['_design/daily-sop-role-assessment', 'daily-sop-role-assessment-by-shelter-date'],
			allow_fallback: false,
			limit: 100
		});
		expect(firstQuery).not.toHaveProperty('skip');

		vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z'));
		const second = await repo.listPage('SH001', first.bookmark, '2026-09-25');
		expect(second.items).toHaveLength(1);
		expect(second.bookmark).toBeNull();
		expect(vi.mocked(couch.findDocsPage).mock.calls[1][1]).toMatchObject({
			selector: firstQuery.selector,
			bookmark: 'bookmark-page-1'
		});
		const ids = [...first.items, ...second.items].map((item) => item._id);
		expect(new Set(ids).size).toBe(DAILY_SOP_ROLE_PAGE_SIZE + 1);
		expect(first.items.map((item) => item.assessment_date)).toEqual(
			[...first.items.map((item) => item.assessment_date)].sort((a, b) => b.localeCompare(a))
		);
		const final = await repo.listPage('SH001', second.bookmark ?? 'bookmark-page-2', '2026-09-25');
		expect(final.items).toEqual([]);
		expect(final.bookmark).toBeNull();
	});

	it('skips documents that fail the schema without breaking paging', async () => {
		const couch = await import('$lib/db/couch-db');
		const valid = validAssessment('FAC', '2026-09-25');
		const prototype = {
			...validAssessment('REG', '2026-09-25'),
			controls: [{ id: 'D-REG-01', check_method: 'old' }]
		};
		const docs = [
			valid,
			prototype,
			...Array.from({ length: DAILY_SOP_ROLE_PAGE_SIZE - 2 }, () => ({ type: 'bad' }))
		];
		vi.mocked(couch.findDocsPage).mockResolvedValueOnce({
			docs,
			bookmark: 'next'
		} as never);

		const page = await new DailySopRoleRemoteRepository('shelter_sh001').listPage('SH001');
		expect(page.items.map((item) => item._id)).toEqual([valid._id]);
		expect(page.bookmark).toBe('next');
	});

	it('saves the current role snapshot without legacy fields or automatic Pass/Fail calculation', async () => {
		const couch = await import('$lib/db/couch-db');
		const draft = completeFacilityDraft();
		draft['D-FAC-01'].measured_values = { usableArea: 1, occupants: 100 };
		expect(
			metricForQuestion('D-FAC-01', validRatios)?.evaluate(draft['D-FAC-01'].measured_values)
		).toBe(false);
		const result = await new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
			'FAC',
			draft,
			'2026-09-25',
			ctx
		);
		const saved = vi.mocked(couch.putDocStrict).mock.calls[0][1] as DailySopRoleAssessment;

		expect(result._id).toBe(buildDailySopRoleId('SH001', '2026-09-25', 'FAC'));
		expect(result.question_set_version).toBe('daily-sop-role-v1');
		expect(result.status).toBe('Completed');
		expect(result.controls).toHaveLength(15);
		expect(result.controls[0]).toMatchObject({
			id: 'D-FAC-01',
			status: 'Pass',
			measured_values: { usableArea: 1, occupants: 100 },
			metric_spec: {
				threshold:
					'ถ้า occupants > 0: usableArea ÷ occupants ≥ 3.5; ถ้า occupants = 0 ให้พื้นที่ขั้นต่ำเป็น 0 ตร.ม.',
				parameter: { key: 'm2_per_person_living', value: '3.5' }
			}
		});
		expect(result.controls[0]).not.toHaveProperty('check_method');
		expect(result.controls[0]).not.toHaveProperty('pass_criteria');
		expect(result.controls[0]).not.toHaveProperty('record_values');
		expect(saved.created_by).toBe(ctx.createdBy);
		expect(saved.controls[0].checked_by).toBe(ctx.createdBy);
	});

	it('requires Pending with a note when a SOP parameter is unavailable', async () => {
		const ratioUnavailableCtx = {
			...ctx,
			sopRatios: { ...validRatios, people_per_toilet_female: undefined }
		};
		const draft = createEmptyRoleDraft('FAC');
		draft['D-FAC-02'].status = 'Pending';
		draft['D-FAC-02'].notes = 'ยังไม่มีค่าอัตราส่วนของศูนย์';
		const result = await new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
			'FAC',
			draft,
			'2026-09-25',
			ratioUnavailableCtx
		);
		const bathroom = result.controls.find((control) => control.id === 'D-FAC-02')!;
		expect(bathroom.metric_spec).toBeNull();
		expect(bathroom.question).toContain('{people_per_toilet_female}');
		expect(bathroom.measured_values).toEqual({});
		expect(bathroom.status).toBe('Pending');
	});

	it('rejects empty, out-of-day, and out-of-role writes before contacting CouchDB', async () => {
		const couch = await import('$lib/db/couch-db');
		const repo = new DailySopRoleRemoteRepository('shelter_sh001');
		await expect(
			repo.createOrUpdate('FAC', createEmptyRoleDraft('FAC'), '2026-09-25', ctx)
		).rejects.toThrow('empty Daily SOP assessment');
		await expect(
			repo.createOrUpdate('FAC', completeFacilityDraft(), '2026-09-24', ctx)
		).rejects.toThrow('other dates are read-only');
		await expect(
			repo.createOrUpdate('FAC', completeFacilityDraft(), '2026-09-25', {
				...ctx,
				roles: ['SH001:registration_staff']
			})
		).rejects.toThrow('Unauthorized');
		expect(couch.putDocStrict).not.toHaveBeenCalled();
	});

	it('updates only the supplied revision and leaves conflict resolution to the user', async () => {
		const couch = await import('$lib/db/couch-db');
		const base = validAssessment('FAC', '2026-09-25');
		const draft = roleDraftFromAssessment(base);
		draft['D-FAC-01'].status = 'Fail';
		draft['D-FAC-01'].notes = 'พื้นที่บางส่วนใช้เก็บของ';
		vi.mocked(couch.putDocStrict).mockRejectedValueOnce(new ConflictError(base._id));

		await expect(
			new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
				'FAC',
				draft,
				'2026-09-25',
				ctx,
				base
			)
		).rejects.toBeInstanceOf(ConflictError);
		expect(couch.putDocStrict).toHaveBeenCalledTimes(1);
		expect((vi.mocked(couch.putDocStrict).mock.calls[0][1] as DailySopRoleAssessment)._rev).toBe(
			'1-test'
		);
		expect(couch.getDoc).not.toHaveBeenCalled();
	});

	it('does not turn a create conflict into an update', async () => {
		const couch = await import('$lib/db/couch-db');
		const draft = createEmptyRoleDraft('FAC');
		draft['D-FAC-01'].status = 'Pass';
		vi.mocked(couch.putDocStrict).mockRejectedValueOnce(
			new ConflictError(buildDailySopRoleId('SH001', '2026-09-25', 'FAC'))
		);

		await expect(
			new DailySopRoleRemoteRepository('shelter_sh001').createOrUpdate(
				'FAC',
				draft,
				'2026-09-25',
				ctx,
				null
			)
		).rejects.toBeInstanceOf(ConflictError);
		expect(couch.putDocStrict).toHaveBeenCalledTimes(1);
		expect(couch.getDoc).not.toHaveBeenCalled();
	});

	it('projects only the existing read-only stock fields and rejects a mismatched shelter response', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					shelter_code: 'SH001',
					last_updated: '2026-09-25T10:00:00Z',
					occupancy: 12,
					items: [
						{
							item_id: 'item:water',
							name: 'น้ำ',
							unit: 'ลิตร',
							qty_on_hand: '40',
							status: 'normal'
						}
					]
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const stock = await fetchDailySopStockStatus('SH001');
		expect(fetchMock).toHaveBeenCalledWith('/api/v1/shelters/SH001/stock-status');
		expect(stock.items).toEqual([
			{ item_id: 'item:water', name: 'น้ำ', unit: 'ลิตร', qty_on_hand: '40' }
		]);
		expect(stock).not.toHaveProperty('occupancy');

		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					shelter_code: 'SH002',
					last_updated: null,
					items: []
				}),
				{ status: 200 }
			)
		);
		await expect(fetchDailySopStockStatus('SH001')).rejects.toThrow('different shelter');
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					shelter_code: 'SH001',
					last_updated: 'invalid timestamp',
					items: [{ item_id: 'item:water', name: 'น้ำ', unit: 'ลิตร', qty_on_hand: 'NaN' }]
				}),
				{ status: 200 }
			)
		);
		await expect(fetchDailySopStockStatus('SH001')).rejects.toThrow();
	});
});
