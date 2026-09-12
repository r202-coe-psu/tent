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
