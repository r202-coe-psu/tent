import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import type { LedgerRefDoc } from '../domain/ledger-ref';
import type { LedgerRefLabels } from './ledger-ref-labels';

const queryClient = new QueryClient();
const listLedgerRefDocs = vi.fn<(ids: readonly string[]) => Promise<LedgerRefDoc[]>>();

vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	// The hook's options are what is under test, not svelte-query's reactivity.
	createQuery: (options: () => unknown) => options(),
	useQueryClient: () => queryClient
}));

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('../data/operations.remote', () => ({
	operationsRepository: () => ({ listLedgerRefDocs }),
	OperationsRemoteRepository: class {}
}));

const { useLedgerRefLabels } = await import('./queries');

type Options = {
	queryKey: readonly unknown[];
	queryFn: () => Promise<LedgerRefLabels>;
	enabled: boolean;
};

/** Runs the hook's query once and stores its result under its key, as svelte-query would. */
async function load(
	refIds: string[]
): Promise<{ key: readonly unknown[]; labels: LedgerRefLabels }> {
	const options = useLedgerRefLabels(() => refIds) as unknown as Options;
	const labels = await options.queryFn();
	queryClient.setQueryData(options.queryKey, labels);
	return { key: options.queryKey, labels };
}

const donation = (id: string, donor: string) => ({
	_id: id,
	type: 'donation',
	donor: { name: donor }
});

describe('useLedgerRefLabels (#811)', () => {
	beforeEach(() => {
		queryClient.clear();
		listLedgerRefDocs.mockReset();
	});

	it('keys on a short digest, not on every ref id', () => {
		const ids = Array.from({ length: 2000 }, (_, i) => `donation:${i}`);
		const { queryKey } = useLedgerRefLabels(() => ids) as unknown as Options;

		expect(queryKey).toHaveLength(4);
		expect(queryKey.slice(0, 3)).toEqual(['operations', 'ledgerRefs', 'SH001']);
	});

	it('reads only kinds that can be labelled', async () => {
		listLedgerRefDocs.mockResolvedValue([]);

		await load(['distribution_log:1', 'donation:1', 'donation:1']);

		expect(listLedgerRefDocs).toHaveBeenCalledWith(['donation:1']);
	});

	it('is disabled when no ref can be labelled', () => {
		const options = useLedgerRefLabels(() => ['distribution_log:1']) as unknown as Options;
		expect(options.enabled).toBe(false);
	});

	it('reads only the new id when the ledger gains a row', async () => {
		listLedgerRefDocs.mockResolvedValueOnce([donation('donation:a', 'ก')]);
		const first = await load(['donation:a']);

		listLedgerRefDocs.mockResolvedValueOnce([donation('donation:b', 'ข')]);
		const second = await load(['donation:a', 'donation:b']);

		expect(second.key).not.toEqual(first.key);
		expect(listLedgerRefDocs).toHaveBeenLastCalledWith(['donation:b']);
		expect(second.labels.get('donation:a')).toBe('ผู้บริจาค ก');
		expect(second.labels.get('donation:b')).toBe('ผู้บริจาค ข');
	});

	it('does not reuse another shelter’s labels', async () => {
		queryClient.setQueryData(
			['operations', 'ledgerRefs', 'SH002', 'x'],
			new Map([['donation:a', 'อื่น']])
		);
		listLedgerRefDocs.mockResolvedValue([donation('donation:a', 'ก')]);

		const { labels } = await load(['donation:a']);

		expect(listLedgerRefDocs).toHaveBeenCalledWith(['donation:a']);
		expect(labels.get('donation:a')).toBe('ผู้บริจาค ก');
	});
});
