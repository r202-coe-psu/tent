import { describe, expect, it } from 'vitest';
import {
	INTAKE_SEARCH_PLACEHOLDER,
	NEW_REGISTRATION_CTA_LABEL,
	REPORT_IN_CTA_LABEL,
	hasFederatedIntakeHits,
	isIntakeNotFoundState,
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
		expect(shelterHitStatusLabel('active')).toContain('เช็คอิน');
	});

	it('is not-found only after a completed search with zero hits on both planes', () => {
		expect(
			isIntakeNotFoundState({ hasSearched: false, localHitCount: 0, centralPoolHitCount: 0 })
		).toBe(false);
		expect(
			isIntakeNotFoundState({ hasSearched: true, localHitCount: 1, centralPoolHitCount: 0 })
		).toBe(false);
		expect(
			isIntakeNotFoundState({ hasSearched: true, localHitCount: 0, centralPoolHitCount: 2 })
		).toBe(false);
		expect(
			isIntakeNotFoundState({ hasSearched: true, localHitCount: 0, centralPoolHitCount: 0 })
		).toBe(true);
	});

	it('detects federated hits when either plane returns results', () => {
		expect(hasFederatedIntakeHits(0, 0)).toBe(false);
		expect(hasFederatedIntakeHits(1, 0)).toBe(true);
		expect(hasFederatedIntakeHits(0, 1)).toBe(true);
	});
});
