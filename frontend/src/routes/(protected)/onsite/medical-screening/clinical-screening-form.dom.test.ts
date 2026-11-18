// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Evacuee, Screening } from '$lib/features/people';
import ClinicalScreeningForm from './clinical-screening-form.svelte';

const mutateAsync = vi.hoisted(() => vi.fn(async () => ({ screening: {} })));

vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useRecordMedicalScreening: () => ({ mutateAsync }),
	useMedicals: () => ({ data: [], isLoading: false, isError: false })
}));
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ({ data: { items: [] }, isLoading: false })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));

const evacuee = {
	_id: 'evacuee:01J',
	shelter_code: 'SH001',
	vulnerable_groups: [],
	special_needs: []
} as unknown as Evacuee;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function render(latest?: Partial<Screening>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(ClinicalScreeningForm, {
		target,
		props: {
			evacuee,
			priorScreening: latest ? { screeningCount: 1, latest: latest as Screening } : null
		}
	});
	await settle();
	return target;
}

async function save(target: HTMLElement) {
	target.querySelector<HTMLButtonElement>('div.sticky button')!.click();
	await settle();
}

function savedTriage() {
	const [[arg]] = mutateAsync.mock.calls as unknown as [[{ input: { screening: Screening } }]];
	return arg.input.screening.triage_level;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	mutateAsync.mockClear();
});

describe('ClinicalScreeningForm triage_level payload (CR-258)', () => {
	it('saves green when staff do not pick a colour', async () => {
		const target = await render();
		await save(target);
		expect(savedTriage()).toBe('green');
	});

	it('saves the colour staff pick', async () => {
		const target = await render();
		target.querySelector<HTMLButtonElement>('#med-triage-yellow')!.click();
		await settle();
		await save(target);
		expect(savedTriage()).toBe('yellow');
	});

	it('keeps the colour of the latest screening when re-saving', async () => {
		const target = await render({ track: 'normal', symptoms: [], triage_level: 'red' });
		await save(target);
		expect(savedTriage()).toBe('red');
	});
});
