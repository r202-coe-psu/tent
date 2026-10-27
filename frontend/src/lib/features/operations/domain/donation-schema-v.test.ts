import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DONATION_SCHEMA_V } from './operations';

describe('DONATION_SCHEMA_V', () => {
	it('is 8 (adds logistics.vehicle_plate) and equals the worker inbound constant', () => {
		expect(DONATION_SCHEMA_V).toBe(8);
		const worker = readFileSync(
			resolve(process.cwd(), '../worker/src/worker/inbound/donations.py'),
			'utf8'
		);
		const match = worker.match(/^DONATION_SCHEMA_V = (\d+)$/m);
		expect(Number(match?.[1])).toBe(DONATION_SCHEMA_V);
	});
});
