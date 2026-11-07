import { describe, expect, it } from 'vitest';
import { canPrintSource, PRINT_SOURCE_CAPABILITIES, printRolesFor } from './print-permission';

const SA = ['system_admin'];
const SM = ['shelter:SH001', 'SH001:shelter_manager'];
const REG = ['shelter:SH001', 'SH001:registration_staff'];
const KITCHEN = ['shelter:SH001', 'SH001:kitchen_staff'];
const OTHER_SHELTER = ['shelter:SH001', 'SH002:registration_staff'];
const NO_SCOPE = ['SH001:registration_staff'];
const LEGACY_FLAT = ['shelter:SH001', 'registration_staff'];
const COUCH_ADMIN_ONLY = ['_admin'];

describe('printRolesFor', () => {
	it.each([
		['SH001', 'walk_in', ['SH001:registration_staff', 'SH001:shelter_manager']],
		['SH001', 'evacuee_qr', ['SH001:registration_staff', 'SH001:shelter_manager']],
		['SH001', 'test', ['SH001:shelter_manager']],
		['sh002', 'test', ['SH002:shelter_manager']],
		['SH001', 'bogus', []]
	])('%s + %s -> %j', (code, source, expected) => {
		expect(printRolesFor(code, source)).toEqual(expected);
	});
});

describe('PRINT_SOURCE_CAPABILITIES', () => {
	it('matches the FR-29a table', () => {
		expect(PRINT_SOURCE_CAPABILITIES).toEqual({
			walk_in: ['registration_staff', 'shelter_manager'],
			evacuee_qr: ['registration_staff', 'shelter_manager'],
			test: ['shelter_manager']
		});
	});
});

describe('canPrintSource', () => {
	it.each([
		['SA', SA, 'walk_in', true],
		['SA', SA, 'evacuee_qr', true],
		['SA', SA, 'test', true],
		['shelter_manager', SM, 'walk_in', true],
		['shelter_manager', SM, 'evacuee_qr', true],
		['shelter_manager', SM, 'test', true],
		['registration_staff', REG, 'walk_in', true],
		['registration_staff', REG, 'evacuee_qr', true],
		['registration_staff', REG, 'test', false],
		['kitchen_staff', KITCHEN, 'walk_in', false],
		['kitchen_staff', KITCHEN, 'evacuee_qr', false],
		['kitchen_staff', KITCHEN, 'test', false],
		['role of another shelter', OTHER_SHELTER, 'walk_in', false],
		['role of another shelter', OTHER_SHELTER, 'evacuee_qr', false],
		['role of another shelter', OTHER_SHELTER, 'test', false],
		['missing shelter scope', NO_SCOPE, 'walk_in', false],
		['missing shelter scope', NO_SCOPE, 'evacuee_qr', false],
		['missing shelter scope', NO_SCOPE, 'test', false],
		['legacy flat role', LEGACY_FLAT, 'walk_in', false],
		['legacy flat role', LEGACY_FLAT, 'evacuee_qr', false],
		['legacy flat role', LEGACY_FLAT, 'test', false],
		['_admin only', COUCH_ADMIN_ONLY, 'walk_in', false],
		['_admin only', COUCH_ADMIN_ONLY, 'test', false],
		['empty roles', [], 'walk_in', false],
		['shelter_manager, unknown source', SM, 'bogus', false],
		['SA, unknown source', SA, 'bogus', false]
	])('%s may print %s? (%#)', (_who, roles, source, expected) => {
		expect(canPrintSource(roles, 'SH001', source)).toBe(expected);
	});

	it('matches a lower-case shelter code against upper-case roles', () => {
		expect(canPrintSource(REG, 'sh001', 'walk_in')).toBe(true);
		expect(canPrintSource(REG, 'sh001', 'test')).toBe(false);
	});
});
