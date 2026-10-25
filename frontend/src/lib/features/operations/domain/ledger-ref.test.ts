import { describe, expect, it } from 'vitest';
import { isLedgerRefDoc, ledgerRefLabels, shortLedgerRef } from './ledger-ref';

describe('shortLedgerRef', () => {
	it.each([
		['donation:01M5KX8TQ4Q503Z0P2H17YAKTK', 'ใบบริจาค · …YAKTK'],
		['requisition_ticket:01M5KX8TQ4Q503Z0P2H1ABCDE', 'ตั๋วเบิก · …ABCDE'],
		['kitchen_requisition:01M5KX8TQ4Q503Z0P2H1ABCDE', 'ใบเบิกครัว · …ABCDE'],
		['stock_transfer:01M5KX8TQ4Q503Z0P2H1ABCDE', 'ใบโอนย้าย · …ABCDE'],
		['meal_service:01M5KX8TQ4Q503Z0P2H1ABCDE', 'ใบรับจากครัว · …ABCDE'],
		['distribution_log:01M5KX8TQ4Q503Z0P2H1ABCDE', 'บันทึกแจกจ่าย · …ABCDE'],
		['distribution_batch:01M5KX8TQ4Q503Z0P2H1ABCDE', 'รอบแจกจ่าย · …ABCDE'],
		['bulk_return_pool:01M5KX8TQ4Q503Z0P2H1ABCDE', 'คืนของรวม · …ABCDE']
	])('%s → %s', (refId, expected) => {
		expect(shortLedgerRef(refId)).toBe(expected);
	});

	it('keeps a short id whole', () => {
		expect(shortLedgerRef('donation:DN-1')).toBe('ใบบริจาค · DN-1');
	});

	it('keeps an unknown prefix as written', () => {
		expect(shortLedgerRef('legacy_doc:01M5KX8TQ4Q503Z0P2H1ABCDE')).toBe('legacy_doc · …ABCDE');
	});

	it('returns an id without a prefix unchanged', () => {
		expect(shortLedgerRef('plain-id')).toBe('plain-id');
	});
});

describe('ledgerRefLabels', () => {
	const labelOf = (doc: Record<string, unknown>) =>
		ledgerRefLabels([{ _id: 'x:1', type: 'unknown', ...doc }]).get('x:1');

	it('names a donation by its donor and booking ref', () => {
		expect(labelOf({ type: 'donation', donor: { name: 'ร้านป้าแดง' } })).toBe(
			'ผู้บริจาค ร้านป้าแดง'
		);
		expect(
			labelOf({ type: 'donation', donor: { name: 'ร้านป้าแดง' }, booking_ref: 'BK-0012' })
		).toBe('ผู้บริจาค ร้านป้าแดง · BK-0012');
	});

	it('names a requisition ticket by its ticket number', () => {
		expect(labelOf({ type: 'requisition_ticket', ticket_no: 'TKT-KITCHEN-0012' })).toBe(
			'ตั๋วเบิก TKT-KITCHEN-0012'
		);
	});

	it('names a kitchen yield by its receipt number', () => {
		expect(labelOf({ type: 'meal_service', receipt_no: 'RCV-KITCHEN-0003' })).toBe(
			'ใบรับจากครัว RCV-KITCHEN-0003'
		);
	});

	it('names a transfer by its shelters', () => {
		expect(labelOf({ type: 'stock_transfer', from_shelter: 'SH001', to_shelter: 'SH002' })).toBe(
			'โอนย้าย SH001 → SH002'
		);
	});

	it('leaves out docs with nothing better than their id', () => {
		expect(labelOf({ type: 'donation', donor: { name: '  ' } })).toBeUndefined();
		expect(labelOf({ type: 'meal_service' })).toBeUndefined();
		expect(labelOf({ type: 'kitchen_requisition', items: [] })).toBeUndefined();
	});
});

describe('isLedgerRefDoc', () => {
	it('accepts a doc with an id and a type only', () => {
		expect(isLedgerRefDoc({ _id: 'donation:1', type: 'donation' })).toBe(true);
		expect(isLedgerRefDoc({ _id: 'donation:1' })).toBe(false);
		expect(isLedgerRefDoc(null)).toBe(false);
	});
});
