import { describe, expect, it } from 'vitest';
import {
	INTAKE_SEARCH_PLACEHOLDER,
	NEW_REGISTRATION_CTA_LABEL,
	OVERRIDE_NEW_REG_BODY,
	OVERRIDE_NEW_REG_CANCEL,
	OVERRIDE_NEW_REG_CONFIRM,
	OVERRIDE_NEW_REG_POOL_ERROR_BODY,
	OVERRIDE_NEW_REG_TITLE,
	REPORT_IN_CTA_LABEL,
	deriveDuplicateCheckQuery,
	deriveDuplicateCheckQueries,
	duplicateCheckKey,
	hasFederatedIntakeHits,
	isIntakeNewRegistrationLocked,
	resolveNewRegistrationCta,
	resolveShelterHitAction,
	shelterHitStatusLabel
} from './intake-search';

describe('Station 1 intake search (#251)', () => {
	it('exposes search-first copy for ID / passport / name / phone and CTAs', () => {
		expect(INTAKE_SEARCH_PLACEHOLDER).toContain('เลขบัตรประชาชน');
		expect(INTAKE_SEARCH_PLACEHOLDER).toContain('หนังสือเดินทาง');
		expect(INTAKE_SEARCH_PLACEHOLDER).toContain('ชื่อ-นามสกุล');
		expect(INTAKE_SEARCH_PLACEHOLDER).toContain('เบอร์โทร');
		expect(REPORT_IN_CTA_LABEL).toBe('รับรายงานตัว (Report-in)');
		expect(NEW_REGISTRATION_CTA_LABEL).toBe('+ ลงทะเบียนใหม่');
	});

	it('routes pre_registered local hits to Report-in', () => {
		expect(resolveShelterHitAction('pre_registered')).toBe('report_in');
	});

	it('shows status for already-active / arriving (and other) local hits — no duplicate create', () => {
		expect(resolveShelterHitAction('arriving')).toBe('show_status');
		expect(resolveShelterHitAction('active')).toBe('show_status');
		expect(resolveShelterHitAction('room_confirmed')).toBe('show_status');
		expect(resolveShelterHitAction('checked_out')).toBe('show_status');
	});

	it('labels stay status for anti-duplicate display', () => {
		expect(shelterHitStatusLabel('arriving')).toContain('รอเข้าพัก');
		expect(shelterHitStatusLabel('active')).toContain('เข้าพัก');
	});

	it('detects federated hits when either plane returns results', () => {
		expect(hasFederatedIntakeHits(0, 0)).toBe(false);
		expect(hasFederatedIntakeHits(1, 0)).toBe(true);
		expect(hasFederatedIntakeHits(0, 1)).toBe(true);
	});

	it('locks new-reg on federated hits or pool-error path until override', () => {
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: true,
				poolError: false,
				hasFederatedHits: true,
				overrideConfirmed: false
			})
		).toBe(true);
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: false,
				overrideConfirmed: false
			})
		).toBe(true);
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: true,
				overrideConfirmed: false
			})
		).toBe(true);
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: false,
				overrideConfirmed: true
			})
		).toBe(false);
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: true,
				poolError: false,
				hasFederatedHits: false,
				overrideConfirmed: false
			})
		).toBe(false);
		expect(
			isIntakeNewRegistrationLocked({
				hasSearched: false,
				poolError: false,
				hasFederatedHits: false,
				overrideConfirmed: false
			})
		).toBe(false);
	});

	it('hard-gates new-reg: hidden while federated hits lock without override', () => {
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: false,
				hasFederatedHits: true,
				overrideConfirmed: false
			})
		).toBe('hidden');
	});

	it('shows outlined/warned new-reg only after explicit override on hits', () => {
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: false,
				hasFederatedHits: true,
				overrideConfirmed: true
			})
		).toBe('outlined_override');
	});

	it('shows prominent new-reg when search completed with zero hits and no pool error', () => {
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: false,
				hasFederatedHits: false,
				overrideConfirmed: false
			})
		).toBe('prominent');
	});

	it('suppresses not-found while pool verification failed until override', () => {
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: false,
				overrideConfirmed: false
			})
		).toBe('hidden');
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: true,
				overrideConfirmed: false
			})
		).toBe('hidden');
	});

	it('allows outlined new-reg after override even when pool verification failed', () => {
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: false,
				overrideConfirmed: true
			})
		).toBe('outlined_override');
		expect(
			resolveNewRegistrationCta({
				hasSearched: true,
				poolError: true,
				hasFederatedHits: true,
				overrideConfirmed: true
			})
		).toBe('outlined_override');
	});

	it('exposes Thai override confirm copy including pool-error warning', () => {
		expect(OVERRIDE_NEW_REG_TITLE).toBe('ยืนยันลงทะเบียนใหม่?');
		expect(OVERRIDE_NEW_REG_BODY).toContain('ระบบพบรายการที่ตรงกับการค้นหา');
		expect(OVERRIDE_NEW_REG_POOL_ERROR_BODY).toContain('ตรวจสอบคิวกลางไม่ครบ');
		expect(OVERRIDE_NEW_REG_CONFIRM).toBe('ยืนยันลงทะเบียนใหม่');
		expect(OVERRIDE_NEW_REG_CANCEL).toBe('ยกเลิก');
	});
});

describe('deriveDuplicateCheckQuery (walk-in /new hard-lock re-check)', () => {
	it('prefers the identity document number over phone and name', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				phone: '0812345678',
				person_id: { number: '1234567890123' }
			})
		).toBe('1234567890123');
	});

	it('falls back to phone when there is no identity document number', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				phone: '0812345678',
				person_id: { number: '' }
			})
		).toBe('0812345678');
	});

	it('falls back to full name when neither identity number nor phone is present', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				phone: null,
				person_id: null
			})
		).toBe('สมชาย ใจดี');
	});

	it('trims a mononym (empty last_name) to just the first name', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: 'Somchai',
				last_name: '',
				phone: null,
				person_id: undefined
			})
		).toBe('Somchai');
	});

	it('skips a system-minted Anonymous ID and falls back to phone / name', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: 'สมหญิง',
				last_name: 'ไม่มีบัตร',
				phone: null,
				person_id: { number: 'ANON-01JABCDEFGHJKMNPQRSTVWXYZ0' }
			})
		).toBe('สมหญิง ไม่มีบัตร');
	});

	it('returns null when there is nothing at all to search on', () => {
		expect(
			deriveDuplicateCheckQuery({
				first_name: '',
				last_name: '',
				phone: null,
				person_id: null
			})
		).toBeNull();
	});
});

describe('deriveDuplicateCheckQueries (every member, not just members[0])', () => {
	it('derives one query per member and keeps their indexes', () => {
		expect(
			deriveDuplicateCheckQueries([
				{ first_name: 'หัว', last_name: 'บ้าน', phone: '0811111111', person_id: null },
				{ first_name: 'ลูก', last_name: 'คนโต', phone: null, person_id: null },
				{ first_name: '', last_name: '', phone: null, person_id: null }
			])
		).toEqual([
			{ query: '0811111111', memberIndexes: [0] },
			{ query: 'ลูก คนโต', memberIndexes: [1] }
		]);
	});

	it('searches a shared family phone once but keeps every member index', () => {
		expect(
			deriveDuplicateCheckQueries([
				{ first_name: 'ก', phone: '0811111111' },
				{ first_name: 'ข', phone: '0811111111' }
			])
		).toEqual([{ query: '0811111111', memberIndexes: [0, 1] }]);
	});

	it('checks anonymous members by name', () => {
		expect(
			deriveDuplicateCheckQueries([
				{
					first_name: 'สมหญิง',
					last_name: '',
					person_id: { number: 'ANON-01JABCDEFGHJKMNPQRSTVWXYZ0' }
				}
			])
		).toEqual([{ query: 'สมหญิง', memberIndexes: [0] }]);
	});
});

describe('duplicateCheckKey', () => {
	it('is order-independent so re-ordering cards keeps the override', () => {
		const a = [
			{ query: 'x', memberIndexes: [0] },
			{ query: 'y', memberIndexes: [1] }
		];
		const b = [
			{ query: 'y', memberIndexes: [0] },
			{ query: 'x', memberIndexes: [1] }
		];
		expect(duplicateCheckKey(a)).toBe(duplicateCheckKey(b));
	});

	it('changes when a query is added', () => {
		expect(duplicateCheckKey([{ query: 'x', memberIndexes: [0] }])).not.toBe(
			duplicateCheckKey([
				{ query: 'x', memberIndexes: [0] },
				{ query: 'z', memberIndexes: [1] }
			])
		);
	});
});
