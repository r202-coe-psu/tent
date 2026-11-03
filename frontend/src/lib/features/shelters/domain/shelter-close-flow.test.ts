import { describe, expect, it } from 'vitest';
import {
	canConfirmShelterClose,
	describeShelterCloseResult,
	shelterCloseDialogOpenChange,
	needsShelterCloseModal,
	selectableOperationStatuses,
	shelterCloseCountRows
} from './shelter-close-flow';

describe('needsShelterCloseModal', () => {
	it('opens only when moving a non-closed shelter to closed', () => {
		expect(needsShelterCloseModal('active', 'closed')).toBe(true);
		expect(needsShelterCloseModal('standby', 'closed')).toBe(true);
		expect(needsShelterCloseModal(undefined, 'closed')).toBe(true);
	});
	it('does not open for an already-closed shelter, reopen, or other changes', () => {
		expect(needsShelterCloseModal('closed', 'closed')).toBe(false);
		expect(needsShelterCloseModal('closed', 'active')).toBe(false);
		expect(needsShelterCloseModal('active', 'full_capacity')).toBe(false);
	});
});

describe('selectableOperationStatuses', () => {
	const opts = [{ value: 'active' }, { value: 'closed' }, { value: 'cancelled' }];
	it('hides closed for non-authorised users', () => {
		expect(
			selectableOperationStatuses(opts, { canClose: false, currentStatus: 'active' }).map(
				(o) => o.value
			)
		).toEqual(['active', 'cancelled']);
	});
	it('shows closed for authorised users', () => {
		expect(
			selectableOperationStatuses(opts, { canClose: true, currentStatus: 'active' })
		).toHaveLength(3);
	});
	it('keeps closed visible when the shelter is already closed', () => {
		expect(
			selectableOperationStatuses(opts, { canClose: false, currentStatus: 'closed' })
		).toHaveLength(3);
	});
});

describe('shelterCloseCountRows', () => {
	it('drops zero counts, labels, and sorts by count desc', () => {
		const rows = shelterCloseCountRows(
			{ active: 3, arriving: 0, pre_registered: 5, mystery: 1 },
			{ active: 'เข้าพักแล้ว', pre_registered: 'ลงทะเบียนล่วงหน้า' }
		);
		expect(rows).toEqual([
			{ status: 'pre_registered', label: 'ลงทะเบียนล่วงหน้า', count: 5 },
			{ status: 'active', label: 'เข้าพักแล้ว', count: 3 },
			{ status: 'mystery', label: 'mystery', count: 1 }
		]);
	});
	it('returns [] for no people', () => {
		expect(shelterCloseCountRows({}, {})).toEqual([]);
	});
});

describe('describeShelterCloseResult', () => {
	it('success message', () => {
		expect(
			describeShelterCloseResult({ closed: true, checked_out: 4, cancelled: 2, failed: [] })
		).toEqual({ kind: 'success', message: 'ปิดศูนย์แล้ว · เช็คเอาต์ 4 คน · ยกเลิก 2 คน' });
	});
	it('failure counts failed people', () => {
		const r = describeShelterCloseResult({
			closed: false,
			checked_out: 1,
			cancelled: 0,
			failed: [{ evacuee_id: 'a', error: 'x' }]
		});
		expect(r.kind).toBe('error');
		expect(r.message).toBe('ล้มเหลว 1 คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ');
	});
	it('not closed with no failures says people remain', () => {
		const r = describeShelterCloseResult({
			closed: false,
			checked_out: 0,
			cancelled: 0,
			failed: []
		});
		expect(r.kind).toBe('error');
		expect(r.message).toContain('ยังมีผู้พักพิงค้างอยู่');
	});
});

describe('shelterCloseDialogOpenChange (FR-18, FR-19)', () => {
	it('keeps the dialog open and cancels nothing while the close runs', () => {
		expect(shelterCloseDialogOpenChange(true, false)).toEqual({ open: true, cancelled: false });
		expect(shelterCloseDialogOpenChange(true, true)).toEqual({ open: true, cancelled: false });
	});

	it('a close request while idle is a cancel', () => {
		expect(shelterCloseDialogOpenChange(false, false)).toEqual({ open: false, cancelled: true });
	});

	it('opening while idle is not a cancel', () => {
		expect(shelterCloseDialogOpenChange(false, true)).toEqual({ open: true, cancelled: false });
	});
});

describe('canConfirmShelterClose (FR-17, FR-19)', () => {
	const base = {
		running: false,
		previewLoaded: true,
		typed: 'SH001 ศูนย์ ก',
		code: 'SH001',
		name: 'ศูนย์ ก'
	};

	it('needs the phrase, loaded counts, and no request in flight', () => {
		expect(canConfirmShelterClose(base)).toBe(true);
		expect(canConfirmShelterClose({ ...base, running: true })).toBe(false);
		expect(canConfirmShelterClose({ ...base, previewLoaded: false })).toBe(false);
		expect(canConfirmShelterClose({ ...base, typed: 'SH001' })).toBe(false);
	});

	it('accepts extra whitespace but not a different case', () => {
		expect(canConfirmShelterClose({ ...base, typed: '  SH001   ศูนย์ ก ' })).toBe(true);
		expect(canConfirmShelterClose({ ...base, typed: 'sh001 ศูนย์ ก' })).toBe(false);
	});
});
