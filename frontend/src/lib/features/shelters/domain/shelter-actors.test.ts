import { describe, expect, it } from 'vitest';
import { formatThaiDateTime } from '$lib/utils/date';
import { shelterActorsLine, UNKNOWN_CREATOR, UNKNOWN_EDITOR } from './shelter-actors';

describe('shelterActorsLine', () => {
	it('shows the display names and Thai date-times', () => {
		const line = shelterActorsLine({
			created_at: '2026-11-12T07:30:00.000Z',
			updated_at: '2026-11-14T02:10:00.000Z',
			created_by_name: 'สมชาย ใจดี',
			updated_by_name: 'suda.p'
		});
		expect(line).toEqual({
			createdBy: 'สมชาย ใจดี',
			createdAt: formatThaiDateTime('2026-11-12T07:30:00.000Z'),
			updatedBy: 'suda.p',
			updatedAt: formatThaiDateTime('2026-11-14T02:10:00.000Z')
		});
	});

	it('falls back to unknown labels for shelters saved before actors were recorded', () => {
		const line = shelterActorsLine({
			created_at: '2026-11-12T07:30:00.000Z',
			updated_at: '2026-11-12T07:30:00.000Z',
			created_by_name: null,
			updated_by_name: '  '
		});
		expect(line.createdBy).toBe(UNKNOWN_CREATOR);
		expect(line.updatedBy).toBe(UNKNOWN_EDITOR);
		expect(line.createdAt).not.toBe('');
	});

	it('leaves the time empty when the timestamp is missing', () => {
		expect(shelterActorsLine({}).createdAt).toBe('');
	});
});
