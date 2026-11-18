import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceFetch = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/service', () => ({ serviceFetch }));

import type { Shelter } from '../domain/schema';
import { updateShelter } from './shelters.api';

const sentBody = () => JSON.parse(serviceFetch.mock.calls[0][1].body as string);

describe('updateShelter capacity payload', () => {
	beforeEach(() => {
		serviceFetch.mockReset().mockResolvedValue({ ok: true, code: 'SH001', rev: '2-x' });
	});

	it('sends an explicit null when an External shelter clears its capacity', async () => {
		await updateShelter('SH001', { is_external: true, capacity: undefined } as Partial<Shelter>);
		expect(sentBody()).toMatchObject({ is_external: true, capacity: null });
	});

	it('keeps a capacity that an External shelter still has', async () => {
		await updateShelter('SH001', { is_external: true, capacity: 120 } as Partial<Shelter>);
		expect(sentBody().capacity).toBe(120);
	});

	it('does not add capacity to a partial patch that is not a full External form save', async () => {
		await updateShelter('SH001', { name: 'ศูนย์ A' });
		expect('capacity' in sentBody()).toBe(false);
	});

	it('does not add capacity for a non-external shelter', async () => {
		await updateShelter('SH001', { is_external: false, capacity: undefined } as Partial<Shelter>);
		expect('capacity' in sentBody()).toBe(false);
	});

	it('keeps _rev beside the null capacity', async () => {
		await updateShelter('SH001', { is_external: true } as Partial<Shelter>, '3-abc');
		expect(sentBody()).toMatchObject({ capacity: null, _rev: '3-abc' });
	});
});
