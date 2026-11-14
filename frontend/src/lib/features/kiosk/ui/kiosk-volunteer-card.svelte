<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Printer from '@lucide/svelte/icons/printer';
	import Search from '@lucide/svelte/icons/search';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { goToKioskClosed, navigateToKioskHome } from '../application/kiosk-navigation';
	import { REPRINT_PHONE_MAX_LENGTH } from '../application/reprint-session.svelte';
	import {
		VolunteerCardSession,
		type VolunteerCardSessionDeps
	} from '../application/volunteer-card-session.svelte';
	import {
		printVolunteerLabel,
		type VolunteerLabelSheet as VolunteerLabelSheetData
	} from '../application/volunteer-label-print';
	import { requestKioskVolunteerCard } from '../data/kiosk-volunteer-card.api';
	import type { KioskContextQuery } from '../domain/display-context';
	import { formatPhoneForDisplay, phoneEntryHint } from '../domain/phone';
	import { volunteerLabelIdentity } from '../domain/volunteer-label';
	import { KIOSK_VOLUNTEER_I18N } from './_constants/kiosk-volunteer.i18n';
	import KioskBackButton from './kiosk-back-button.svelte';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import VolunteerLabelSheet from './volunteer-label-sheet.svelte';

	interface Props {
		contextQuery: KioskContextQuery;
		/** Replaced in tests; the kiosk uses the real endpoint and printer. */
		deps?: Partial<VolunteerCardSessionDeps>;
	}

	let { contextQuery, deps }: Props = $props();

	const t = $derived(getTranslation(KIOSK_VOLUNTEER_I18N, languageStore.current));

	const PRIMARY_BUTTON =
		'min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl';

	/** The label the browser prints when no scanner client answered; null again once printing ends. */
	let sheet = $state.raw<VolunteerLabelSheetData | null>(null);

	async function browserPrint(next: VolunteerLabelSheetData): Promise<void> {
		sheet = next;
		try {
			// The sheet must be on the page before the browser prints it.
			await tick();
			await new Promise<void>((done) => requestAnimationFrame(() => done()));
			window.print();
		} finally {
			sheet = null;
		}
	}

	const session = untrack(
		() =>
			new VolunteerCardSession(
				{
					lookup: (phone) => requestKioskVolunteerCard(phone),
					print: (volunteer) => printVolunteerLabel(volunteer, browserPrint, languageStore.current),
					onClosed: () => goToKioskClosed(contextQuery),
					...deps
				},
				() => languageStore.current
			)
	);
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	const printQrUrl = $derived(resolve(`/kiosk/print-qr${contextQuery}`));
	const volunteerUrl = $derived(resolve(`/kiosk/volunteer${contextQuery}`));
	const displayPhone = $derived(formatPhoneForDisplay(session.phone));
	const entryHint = $derived(phoneEntryHint(session.phone, languageStore.current));
	const identity = $derived(session.volunteer ? volunteerLabelIdentity(session.volunteer) : null);
	const inFlow = $derived(session.step !== 'phone');
	// Not sent home while the label comes out; resuming restarts the idle countdown.
	const printing = $derived(session.step === 'printing');

	$effect(() => {
		idleTimeout.setPaused(printing);
	});

	onMount(() => {
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			session.reset();
		};
	});

	function returnHome(): void {
		session.reset();
		navigateToKioskHome(contextQuery);
	}

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#snippet errorLine()}
	<!-- Always in the page so a screen reader hears the message the moment it appears. -->
	<div class="min-h-7" aria-live="polite" role="status">
		{#if session.error}
			<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert"
				>{session.error}</KioskInlineAlert
			>
		{/if}
	</div>
{/snippet}

{#if session.step === 'done'}
	<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 py-3">
		<KioskNoticePanel
			tone="success"
			icon={CheckCircle2}
			title={t.done.title}
			headingTag="h1"
			role="status"
		>
			<p>{t.done.body}</p>
			{#snippet actions()}
				<Button type="button" onclick={returnHome} class={KIOSK_NOTICE_PRIMARY_ACTION}
					>{t.done.home}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	</div>
{:else if session.step === 'print_failed'}
	<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 py-3">
		<KioskNoticePanel
			tone="warning"
			icon={CircleAlert}
			title={t.printFailed.title}
			headingTag="h1"
			role="alert"
		>
			<p>{t.printFailed.body(session.error)}</p>
			{#snippet actions()}
				<Button
					type="button"
					onclick={() => void session.retryPrint()}
					disabled={session.busy}
					class={KIOSK_NOTICE_PRIMARY_ACTION}
					><Printer aria-hidden="true" />{t.printFailed.retry}</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={returnHome}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.printFailed.home}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	</div>
{:else}
	<div
		class="volunteer-card-page mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3"
		data-volunteer-step={session.step}
	>
		<div class="no-print flex justify-start">
			{#if inFlow}
				<KioskBackButton
					href={volunteerUrl}
					label={t.back}
					disabled={printing || session.busy}
					onclick={() => session.back()}
				/>
			{:else}
				<KioskBackButton href={printQrUrl} label={t.backToChooser} />
			{/if}
		</div>

		{#if session.step === 'phone'}
			<div class="flex min-h-0 flex-1 flex-col gap-3 kiosk-portrait:justify-start">
				<KioskNumpadPanel
					bind:value={session.phone}
					maxLength={REPRINT_PHONE_MAX_LENGTH}
					disabled={session.busy}
					onsubmit={() => void session.submitPhone()}
					labelledby="volunteer-phone-title"
					class="kiosk-portrait:mt-4"
				>
					{#snippet header()}
						<header class="text-center">
							<h1
								id="volunteer-phone-title"
								class="text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
							>
								{t.heading}
							</h1>
							<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl">
								{t.phonePrompt}
							</p>
						</header>
					{/snippet}

					{#snippet display()}
						<output
							class={[
								'flex min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-2xl font-bold text-slate-950 tabular-nums kiosk-portrait:min-h-20 kiosk-portrait:rounded-2xl kiosk-portrait:border-2',
								displayPhone
									? 'kiosk-portrait:text-4xl'
									: 'kiosk-portrait:text-2xl kiosk-portrait:font-semibold kiosk-portrait:text-slate-400'
							]}
							aria-label={t.phoneLabel}
							aria-live="polite"
						>
							{displayPhone || t.phonePlaceholder}
						</output>
					{/snippet}

					{#snippet actions()}
						<Button
							type="button"
							disabled={!session.canSubmitPhone}
							onclick={() => void session.submitPhone()}
							class={PRIMARY_BUTTON}
						>
							{#if session.busy}
								<span
									class="inline-block size-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
									aria-hidden="true"
								></span>{t.searching}
							{:else}
								<Search class="h-5 w-5" aria-hidden="true" />{t.search}
							{/if}
						</Button>
					{/snippet}

					{#snippet footer()}
						{#if session.error}
							{@render errorLine()}
						{:else}
							<p
								class="hidden min-h-7 text-center text-lg font-semibold text-amber-900 kiosk-portrait:block"
								aria-live="polite"
							>
								{entryHint ?? ''}
							</p>
						{/if}
					{/snippet}
				</KioskNumpadPanel>
			</div>
		{:else if identity}
			<!-- confirm, and printing (the card stays on screen behind the print status) -->
			<section
				class="no-print mx-auto flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xs kiosk-portrait:mt-4 kiosk-portrait:gap-6 kiosk-portrait:p-8 kiosk-compact:gap-2 kiosk-compact:p-4"
				aria-labelledby="volunteer-confirm-title"
			>
				<h1
					id="volunteer-confirm-title"
					class="text-xl font-bold text-slate-700 kiosk-portrait:text-3xl kiosk-compact:text-lg"
				>
					{t.confirmHeading}
				</h1>
				<p
					class="text-3xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-5xl kiosk-compact:text-2xl"
				>
					{identity.name}
				</p>
				<p
					class="text-xl font-semibold text-slate-800 kiosk-portrait:text-3xl kiosk-compact:text-lg"
				>
					{t.badge(session.volunteer?.volunteer_code ?? '')}
				</p>
				<div class="flex flex-col gap-3 kiosk-compact:gap-2">
					<Button
						type="button"
						disabled={session.busy}
						onclick={() => void session.confirmPrint()}
						class={PRIMARY_BUTTON}
					>
						<Printer class="h-5 w-5" aria-hidden="true" />{t.print}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={session.busy}
						onclick={() => session.back()}
						class="min-h-12 w-full border-[#CBD5E1] text-base font-semibold text-[#0A2647] kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
						>{t.notMe}</Button
					>
				</div>
			</section>
		{/if}
	</div>
{/if}

<VolunteerLabelSheet {sheet} />
{#if printing}
	<KioskPrintStatus phase="printing" count={1} />
{/if}
