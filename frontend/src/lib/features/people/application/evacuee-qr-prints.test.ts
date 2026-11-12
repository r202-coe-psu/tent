import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvacueeQrPrintRef } from '$lib/utils/evacuee-qr';

const readEvacueeQrPrints = vi.fn<(id: string) => Promise<EvacueeQrPrintRef[]>>();

vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	// The hook's options are what is under test, not svelte-query's reactivity.
	createQuery: (options: () => unknown) => options()
}));
vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));
vi.mock('../data/evacuee-qr.remote', () => ({ readEvacueeQrPrints }));

const { useEvacueeQrPrints } = await import('./evacuee-qr-prints');
const { peopleKeys } = await import('./queries');

type Options = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; enabled: boolean };

const ID = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';

describe('useEvacueeQrPrints (#1301)', () => {
	beforeEach(() => readEvacueeQrPrints.mockReset());

	it('reads the prints log of that evacuee under the people query key', async () => {
		const prints = [{ printed_at: 'a', hash: 'aaaaaa', marker: 'red' as const }];
		readEvacueeQrPrints.mockResolvedValue(prints);
		const options = useEvacueeQrPrints(() => ID) as unknown as Options;

		expect(options.queryKey).toEqual(peopleKeys.evacueeQrPrints(ID));
		expect(await options.queryFn()).toEqual(prints);
		expect(readEvacueeQrPrints).toHaveBeenCalledWith(ID);
	});

	it('does not run without an evacuee id', () => {
		const options = useEvacueeQrPrints(() => '') as unknown as Options;
		expect(options.enabled).toBe(false);
	});
});
