// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCouchFetch } from '$lib/testing/fake-couch-fetch';
import {
	createEmptyRoleDraft,
	questionsForRole,
	roleDraftFromAssessment
} from '../domain/daily-sop';
import { validRatios } from '$lib/features/sop-ratios/domain/sop-ratio.fixture';

// CR-260 FR-C3: with a user logged in, couch-db stamps `updated_by` on every shelter write.
// The other repository tests mock couch-db away (and run with no user), so they never see it.
const auth = vi.hoisted(() => ({ user: { name: 'fac01' } as { name: string } | null }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return auth.user;
		},
		handleAuthFailure: vi.fn()
	}
}));
vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: { markConnected: vi.fn(), markDisconnected: vi.fn() }
}));

import { buildDailySopRoleId, DailySopRoleRemoteRepository } from './daily-sop.remote';

const DB = 'shelter_sh001';
const ctx = {
	shelterCode: 'SH001',
	createdBy: 'fac01',
	assessorName: 'ผู้ตรวจสถานที่',
	roles: ['SH001:facility_staff'],
	sopRatios: validRatios
};

function facilityDraft() {
	const draft = createEmptyRoleDraft('FAC');
	for (const question of questionsForRole('FAC')) draft[question.id].status = 'Pass';
	return draft;
}

describe('Daily SOP role repository with the writer stamp (CR-260)', () => {
	const couch = createFakeCouchFetch();

	beforeEach(() => {
		couch.reset();
		auth.user = { name: 'fac01' };
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-25T03:00:00.000Z'));
		vi.stubGlobal('fetch', couch.fetch);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('saves, reads back, lists and updates an assessment that carries updated_by', async () => {
		const repo = new DailySopRoleRemoteRepository(DB);
		const id = buildDailySopRoleId('SH001', '2026-09-25', 'FAC');

		const created = await repo.createOrUpdate('FAC', facilityDraft(), '2026-09-25', ctx);
		expect(created.updated_by).toBe('fac01');
		expect(couch.get(DB, id)?.updated_by).toBe('fac01');

		const stored = await repo.read(id);
		expect(stored).toMatchObject({ _id: id, updated_by: 'fac01' });
		expect((await repo.listPage('SH001')).items.map((item) => item._id)).toEqual([id]);

		// A second assessor edits it from the stored doc, which already carries the first stamp.
		auth.user = { name: 'fac02' };
		const edit = roleDraftFromAssessment(stored!);
		edit['D-FAC-01'].notes = 'ตรวจซ้ำรอบบ่าย';
		const updated = await repo.createOrUpdate(
			'FAC',
			edit,
			'2026-09-25',
			{ ...ctx, createdBy: 'fac02' },
			stored
		);
		expect(updated.updated_by).toBe('fac02');
		expect(couch.get(DB, id)).toMatchObject({ updated_by: 'fac02', created_by: 'fac01' });
	});
});
