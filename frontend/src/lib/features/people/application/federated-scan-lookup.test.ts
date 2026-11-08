import { describe, expect, it, vi } from 'vitest';
import type { Evacuee } from '../domain/people';
import {
	lookupFederatedByScanCodeWithDeps,
	type FederatedScanLookupDeps
} from './federated-scan-lookup';

function ev(id: string): Evacuee {
	return {
		_id: id,
		_rev: '1',
		type: 'evacuee',
		schema_v: 1,
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male',
		current_stay: { status: 'arriving', zone: null },
		created_at: '',
		updated_at: '',
		created_by: 'test',
		shelter_code: 'sh001'
	} as Evacuee;
}

describe('lookupFederatedByScanCodeWithDeps', () => {
	it('returns couch hit on getEvacuee', async () => {
		const found = ev('evacuee:01A');
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(found),
			searchEvacuees: vi.fn(),
			searchUnassigned: vi.fn(),
			listQrPrints: vi.fn().mockResolvedValue([])
		};
		const hit = await lookupFederatedByScanCodeWithDeps('evacuee:01A', deps);
		expect(hit).toEqual({ source: 'couch', evacuee: found });
		expect(deps.searchEvacuees).not.toHaveBeenCalled();
		expect(deps.searchUnassigned).not.toHaveBeenCalled();
	});

	it('falls back to couch search then mongo unassigned', async () => {
		const poolHit = {
			id: 'reg-1',
			reserved_household_id: 'household:1',
			registered_via: 'web' as const,
			status: 'open',
			created_at: '',
			open_members: []
		};
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(null),
			searchEvacuees: vi.fn().mockResolvedValue([]),
			searchUnassigned: vi.fn().mockResolvedValue({ results: [poolHit] }),
			listQrPrints: vi.fn().mockResolvedValue([])
		};
		const hit = await lookupFederatedByScanCodeWithDeps('reg-1', deps);
		expect(hit).toEqual({ source: 'unassigned', hit: poolHit });
		expect(deps.searchUnassigned).toHaveBeenCalledWith('reg-1');
	});

	it('returns null when couch and mongo miss', async () => {
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockRejectedValue(new Error('missing')),
			searchEvacuees: vi.fn().mockResolvedValue([]),
			searchUnassigned: vi.fn().mockResolvedValue({ results: [] }),
			listQrPrints: vi.fn().mockResolvedValue([])
		};
		expect(await lookupFederatedByScanCodeWithDeps('unknown', deps)).toBeNull();
	});

	it('parses zoning path before couch get', async () => {
		const found = ev('evacuee:PATH');
		const deps: FederatedScanLookupDeps = {
			getEvacuee: vi.fn().mockResolvedValue(found),
			searchEvacuees: vi.fn(),
			searchUnassigned: vi.fn(),
			listQrPrints: vi.fn().mockResolvedValue([])
		};
		await lookupFederatedByScanCodeWithDeps('/onsite/zoning/evacuee:PATH', deps);
		expect(deps.getEvacuee).toHaveBeenCalledWith('evacuee:PATH');
	});

	describe('Person QR scan rule (CR-233)', () => {
		const ID = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
		const OLD = { printed_at: '2026-11-03T02:10:00.000Z', hash: '289170' };
		const NEW = { printed_at: '2026-11-05T09:41:12.512Z', hash: '2d23a3' };

		function qrDeps(prints: { printed_at: string; hash: string }[] | Error) {
			return {
				getEvacuee: vi.fn().mockResolvedValue(ev(ID)),
				searchEvacuees: vi.fn().mockResolvedValue([]),
				searchUnassigned: vi.fn().mockResolvedValue({ results: [] }),
				listQrPrints: vi.fn().mockImplementation(async () => {
					if (prints instanceof Error) throw prints;
					return prints;
				})
			} satisfies FederatedScanLookupDeps;
		}

		it('opens the evacuee for the latest hash, passing the id without @', async () => {
			const deps = qrDeps([OLD, NEW]);
			const hit = await lookupFederatedByScanCodeWithDeps(`${ID}@2d23a3`, deps);
			expect(hit?.source).toBe('couch');
			expect(deps.listQrPrints).toHaveBeenCalledWith(ID);
			expect(deps.getEvacuee).toHaveBeenCalledWith(ID);
		});

		it('accepts upper-case hash6 from an upper-casing scanner', async () => {
			const hit = await lookupFederatedByScanCodeWithDeps(`${ID}@2D23A3`, qrDeps([OLD, NEW]));
			expect(hit?.source).toBe('couch');
		});

		it('accepts a legacy QR without @ while there is no log (row 1)', async () => {
			expect((await lookupFederatedByScanCodeWithDeps(ID, qrDeps([])))?.source).toBe('couch');
		});

		it('rejects an old hash as expired without opening anything (row 4)', async () => {
			const deps = qrDeps([OLD, NEW]);
			const hit = await lookupFederatedByScanCodeWithDeps(`${ID}@289170`, deps);
			expect(hit).toMatchObject({
				source: 'qr_rejected',
				verdict: {
					status: 'expired',
					issued_at: OLD.printed_at,
					current_printed_at: NEW.printed_at
				}
			});
			expect(deps.getEvacuee).not.toHaveBeenCalled();
			expect(deps.searchEvacuees).not.toHaveBeenCalled();
			expect(deps.searchUnassigned).not.toHaveBeenCalled();
		});

		it('rejects a legacy QR without @ once a log exists (row 2)', async () => {
			const hit = await lookupFederatedByScanCodeWithDeps(ID, qrDeps([NEW]));
			expect(hit).toMatchObject({
				source: 'qr_rejected',
				verdict: { status: 'expired', issued_at: null }
			});
		});

		it('rejects an unknown hash as invalid (row 5), message carries no name', async () => {
			const hit = await lookupFederatedByScanCodeWithDeps(`${ID}@ffffff`, qrDeps([NEW]));
			expect(hit).toMatchObject({ source: 'qr_rejected', verdict: { status: 'invalid' } });
			expect(hit && 'message' in hit && hit.message).toContain('QR ไม่ถูกต้อง');
			expect(hit && 'message' in hit && hit.message).not.toContain('สมชาย');
		});

		it('never falls back to valid when the log cannot be read', async () => {
			const deps = qrDeps(new Error('offline'));
			await expect(lookupFederatedByScanCodeWithDeps(`${ID}@2d23a3`, deps)).rejects.toThrow(
				'offline'
			);
			expect(deps.getEvacuee).not.toHaveBeenCalled();
		});

		it('does not read the log for a bare ULID registration ticket (FR-EQR-31)', async () => {
			const deps = qrDeps([NEW]);
			await lookupFederatedByScanCodeWithDeps('01JC8ZQ4V6M2N5R7T9XBDEFGH0', deps);
			expect(deps.listQrPrints).not.toHaveBeenCalled();
		});
	});
});
