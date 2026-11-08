<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		abandonWalkIn,
		buildKioskContextQuery,
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION,
		KioskBackButton,
		KioskBusyStatus,
		KioskCheckInWizard,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskNoticePanel,
		KioskRegisterPhone,
		navigateToKioskHome,
		readKioskDisplayQuery,
		restartThaidWalkIn,
		submitWalkIn,
		walkInSession
	} from '$lib/features/kiosk';
	import { KIOSK_REGISTER_PHONE_PAGE_I18N } from './phone-page.i18n';

	const t = $derived(getTranslation(KIOSK_REGISTER_PHONE_PAGE_I18N, languageStore.current));

	const contextQuery = $derived(
		buildKioskContextQuery(readKioskDisplayQuery(page.url.searchParams))
	);
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	const viaThaid = walkInSession.source === 'thaid';
	let registering = $state(false);
	let error = $state('');
	/** ThaiD only: the verified scan is gone, so only a new scan can go on. */
	let expired = $state(false);
	/** The phone typed is already someone else's: shown on the numpad while another is typed. */
	let phoneNotice = $state('');
	/**
	 * Registered (the done page takes the walk-in from here) or sent back to decide consent again:
	 * leaving must not abandon it.
	 */
	let continuing = false;
	// Paused while saving: the write must not be cut short by going home.
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	onMount(() => {
		if (!walkInSession.identityReady) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			if (!continuing && walkInSession.active) abandonWalkIn();
		};
	});

	function activity() {
		idleTimeout.recordActivity();
	}

	function returnHome() {
		abandonWalkIn();
		navigateToKioskHome(contextQuery);
	}

	function scanThaidAgain() {
		abandonWalkIn();
		void goto(resolve(`/kiosk/thaid${contextQuery}`));
	}

	function confirmPhone(phone: string | null) {
		walkInSession.phone = phone;
		void register();
	}

	async function register() {
		if (registering) return;
		registering = true;
		idleTimeout.setPaused(true);
		error = '';
		phoneNotice = '';
		const outcome = await submitWalkIn(walkInSession);
		if (outcome.kind === 'registered') {
			continuing = true;
			walkInSession.registration = outcome.registration;
			await goto(resolve(`/kiosk/register/done${contextQuery}`));
			return;
		}
		if (outcome.kind === 'phone_duplicate') {
			walkInSession.phone = null;
			phoneNotice = outcome.message;
			registering = false;
			idleTimeout.setPaused(false);
			return;
		}
		if (outcome.kind === 'thaid_restart') {
			// The ThaiD scan lived 180 s: re-consenting would only end in a second scan.
			continuing = true;
			restartThaidWalkIn(outcome.message);
			await goto(resolve(`/kiosk/thaid${contextQuery}`));
			return;
		}
		if (outcome.kind === 'consent_expired') {
			// Resending the same decision can never pass: ask for consent again.
			walkInSession.withdrawConsent(outcome.message);
			continuing = true;
			await goto(resolve(`/kiosk/register/consent${contextQuery}`));
			return;
		}
		expired = outcome.kind === 'expired';
		error = outcome.kind === 'ignored' ? t.failedRetry : outcome.message;
		registering = false;
		idleTimeout.setPaused(false);
	}
</script>

<svelte:head><title>{t.pageTitle}</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 py-3 kiosk-compact:gap-1.5 kiosk-compact:py-0"
>
	<KioskCheckInWizard
		currentStep={4}
		step2Label={t.stepConsent}
		step3Label={viaThaid ? t.stepThaid : t.stepCard}
		step4Label={t.stepPhone}
	/>
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} onclick={() => abandonWalkIn()} disabled={registering} />
	</div>
	{#if error}
		<KioskNoticePanel
			tone="warning"
			icon={CircleAlert}
			headingTag="h1"
			title={t.failedTitle}
			role="alert"
		>
			<p>{error}</p>
			{#snippet actions()}
				{#if expired}
					<Button type="button" onclick={scanThaidAgain} class={KIOSK_NOTICE_PRIMARY_ACTION}
						>{t.scanThaidAgain}</Button
					>
				{:else}
					<Button type="button" onclick={register} class={KIOSK_NOTICE_PRIMARY_ACTION}
						>{t.retry}</Button
					>
				{/if}
				<Button
					type="button"
					variant="outline"
					onclick={returnHome}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.cancel}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{:else if registering}
		<KioskNoticePanel tone="info" icon={UserPlus} headingTag="h1" title={t.savingTitle}>
			<KioskBusyStatus>{t.pleaseWait}</KioskBusyStatus>
		</KioskNoticePanel>
	{:else if walkInSession.identityReady}
		<KioskRegisterPhone notice={phoneNotice} onconfirm={confirmPhone} />
	{/if}
</div>
