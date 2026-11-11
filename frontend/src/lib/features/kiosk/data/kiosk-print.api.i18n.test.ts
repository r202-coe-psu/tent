import { describe, expect, it, vi } from 'vitest';
import { KioskPrintError, printKioskLabels } from './kiosk-print.api';

describe('printKioskLabels error codes', () => {
	it('marks an unreachable printer as a connection failure', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

		const error = await printKioskLabels(['a'], fetchFn).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(KioskPrintError);
		expect(error).toMatchObject({ code: 'connection', printed: 0 });
	});

	it('marks a rejected job without a printer message as a send failure', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify({ printed: 0 }), { status: 502 }));

		const error = await printKioskLabels(['a'], fetchFn).catch((caught: unknown) => caught);

		expect(error).toMatchObject({ code: 'send-failed' });
	});

	it('leaves the code empty when the printer explained itself', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ printed: 0, error: { message: 'กระดาษหมด' } }), {
				status: 502
			})
		);

		const error = await printKioskLabels(['a'], fetchFn).catch((caught: unknown) => caught);

		expect((error as KioskPrintError).code).toBeUndefined();
	});
});
