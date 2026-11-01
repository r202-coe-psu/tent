import { describe, expect, it } from 'vitest';
import type { DistributionLog } from '../../domain/food-supplies';
import {
	filterHistory,
	historyRecipientIds,
	historyRecipientNames,
	summarizeHistory
} from './distribution-history';

let seq = 0;
function log(overrides: Partial<DistributionLog> = {}): DistributionLog {
	seq += 1;
	return {
		_id: `distribution_log:${seq}`,
		type: 'distribution_log',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-23T10:00:00.000Z',
		updated_at: '2026-09-23T10:00:00.000Z',
		created_by: 'staff_1',
		ticket_id: 'requisition_ticket:1',
		item_id: 'item_master:rice',
		qty: '1',
		recipient_type: 'evacuee',
		recipient_id: 'evacuee:a',
		is_returnable: false,
		status: 'fulfilled',
		distributed_at: '2026-09-23T10:00:00.000Z',
		distributed_by: 'staff_1',
		is_override: false,
		...overrides
	};
}

const noNames = new Map<string, string>();

describe('historyRecipientIds', () => {
	it('returns sorted unique ids per recipient type and skips outside recipients', () => {
		const ids = historyRecipientIds([
			log({ recipient_id: 'evacuee:b' }),
			log({ recipient_id: 'evacuee:a' }),
			log({ recipient_id: 'evacuee:b' }),
			log({ recipient_type: 'volunteer', recipient_id: 'volunteer:z' }),
			log({ recipient_type: 'outside', recipient_id: null })
		]);
		expect(ids).toEqual({ evacueeIds: ['evacuee:a', 'evacuee:b'], volunteerIds: ['volunteer:z'] });
	});
});

describe('summarizeHistory', () => {
	it('counts rows and distinct recipients, excluding voided rows', () => {
		const summary = summarizeHistory([
			log({ recipient_id: 'evacuee:a' }),
			log({ recipient_id: 'evacuee:a', item_id: 'item_master:water' }),
			log({ recipient_id: 'evacuee:b' }),
			log({ recipient_id: 'evacuee:c', status: 'voided' })
		]);
		expect(summary.rows).toBe(3);
		expect(summary.people).toBe(2);
	});

	it('counts each filter over all rows including voided', () => {
		const summary = summarizeHistory([
			log({ is_override: true, override_reason: 'x' }),
			log({ is_expired_warning: true }),
			log({ status: 'voided', is_override: true }),
			log()
		]);
		expect(summary.counts).toEqual({ all: 4, override: 2, expired: 1, voided: 1 });
	});
});

describe('filterHistory', () => {
	const logs = [
		log({ recipient_id: 'evacuee:a', distributed_at: '2026-09-23T09:00:00.000Z' }),
		log({
			recipient_id: 'evacuee:b',
			is_override: true,
			override_reason: 'Lost Card',
			distributed_at: '2026-09-23T11:00:00.000Z'
		}),
		log({
			recipient_id: 'evacuee:c',
			is_expired_warning: true,
			distributed_at: '2026-09-23T10:00:00.000Z'
		}),
		log({
			recipient_id: 'evacuee:d',
			status: 'voided',
			distributed_at: '2026-09-23T12:00:00.000Z'
		})
	];
	const ids = (rows: DistributionLog[]) => rows.map((r) => r.recipient_id);

	it('sorts newest first', () => {
		expect(ids(filterHistory(logs, { filter: 'all', query: '', names: noNames }))).toEqual([
			'evacuee:d',
			'evacuee:b',
			'evacuee:c',
			'evacuee:a'
		]);
	});

	it.each([
		['override', ['evacuee:b']],
		['expired', ['evacuee:c']],
		['voided', ['evacuee:d']]
	] as const)('filters by %s', (filter, expected) => {
		expect(ids(filterHistory(logs, { filter, query: '', names: noNames }))).toEqual(expected);
	});

	it('combines the filter with the search', () => {
		expect(filterHistory(logs, { filter: 'voided', query: 'lost card', names: noNames })).toEqual(
			[]
		);
	});

	it('searches the display name case-insensitively', () => {
		const names = new Map([['evacuee:a', 'Somchai Jaidee']]);
		expect(ids(filterHistory(logs, { filter: 'all', query: 'SOMCHAI', names }))).toEqual([
			'evacuee:a'
		]);
	});

	it('searches the recipient id and the override reason', () => {
		expect(ids(filterHistory(logs, { filter: 'all', query: 'evacuee:c', names: noNames }))).toEqual(
			['evacuee:c']
		);
		expect(ids(filterHistory(logs, { filter: 'all', query: 'lost card', names: noNames }))).toEqual(
			['evacuee:b']
		);
	});
});

describe('historyRecipientNames', () => {
	it('maps ids to plain names with the nickname in brackets and no volunteer prefix', () => {
		const names = historyRecipientNames([
			{ _id: 'evacuee:A', first_name: 'มาลี', last_name: 'ศรีสุข', nickname: 'ลี' },
			{ _id: 'volunteer:B', first_name: 'สมศักดิ์', last_name: 'ใจดี' }
		]);
		expect(names.get('evacuee:A')).toBe('มาลี ศรีสุข (ลี)');
		expect(names.get('volunteer:B')).toBe('สมศักดิ์ ใจดี');
	});
});
