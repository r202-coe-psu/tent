import { describe, expect, it } from 'vitest';
import { canOverrideStayStatus } from './stay-status-override';

describe('canOverrideStayStatus (CR-262 A1, #1473)', () => {
	it('lets a system admin override anywhere', () => {
		expect(canOverrideStayStatus(['system_admin'], 'SH001')).toBe(true);
	});

	it('lets the shelter manager of the current shelter override, and nobody else there', () => {
		const sm = ['shelter:SH001', 'SH001:shelter_manager'];
		expect(canOverrideStayStatus(sm, 'SH001')).toBe(true);
		expect(canOverrideStayStatus(sm, 'SH002')).toBe(false);
		expect(canOverrideStayStatus(['shelter:SH001', 'SH001:registration_staff'], 'SH001')).toBe(
			false
		);
	});

	it('follows the current shelter for a manager of a second shelter (multi-shelter)', () => {
		// The old rule took the FIRST role shelter, so this manager of SH002 was refused there.
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH002:shelter_manager'];
		expect(canOverrideStayStatus(roles, 'SH002')).toBe(true);
		expect(canOverrideStayStatus(roles, 'SH001')).toBe(false);
	});

	it('accepts a bare shelter_manager only with exactly one shelter scope', () => {
		expect(canOverrideStayStatus(['shelter:SH001', 'shelter_manager'], 'SH001')).toBe(true);
		expect(
			canOverrideStayStatus(['shelter:SH001', 'shelter:SH002', 'shelter_manager'], 'SH001')
		).toBe(false);
	});

	it('matches the shelter code case-insensitively', () => {
		expect(canOverrideStayStatus(['shelter:SH001', 'SH001:shelter_manager'], 'sh001')).toBe(true);
	});

	it('refuses without a current shelter or roles', () => {
		expect(canOverrideStayStatus(['shelter:SH001', 'SH001:shelter_manager'], '')).toBe(false);
		expect(canOverrideStayStatus([], 'SH001')).toBe(false);
	});
});
