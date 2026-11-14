<script lang="ts">
	import { untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import House from '@lucide/svelte/icons/house';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		SelfCheckoutSession,
		type SelfCheckoutStep
	} from '../application/self-checkout-session.svelte';
	import type { GateInput, KioskEvacueeSummary } from '../data/kiosk-check-in.api';
	import { checkOutKioskMembers } from '../data/kiosk-check-out.api';
	import { isSelfCheckoutEligible, selfCheckoutUnavailableReason } from '../domain/self-checkout';
	import { KIOSK_QR_FLOW_I18N } from './_constants/kiosk-qr-flow.i18n';
	import { KIOSK_SELF_CHECKOUT_I18N } from './_constants/kiosk-self-checkout.i18n';
	import KioskBusyStatus from './kiosk-busy-status.svelte';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	/**
	 * #1401: a card / ThaiD visitor already in the shelter checks out at the kiosk. There is no face
	 * check anywhere in this component: it never renders or calls one.
	 */
	interface Props {
		gate: Extract<GateInput, { source: 'smart-card' | 'thaid' }>;
		primaryEvacueeId: string;
		members: KioskEvacueeSummary[];
		/** "ไม่ใช่ กลับ": this is not what the visitor came for; the caller goes on with its usual flow. */
		onnotme: () => void;
		/** Back to the home screen: the done screen's button, or its countdown reaching zero. */
		ondone: () => void;
		/** A request is in flight: the page pauses its idle timeout meanwhile. */
		onbusychange?: (busy: boolean) => void;
		/** The step on screen, so the caller can keep its progress bar in step. */
		onstepchange?: (step: SelfCheckoutStep) => void;
	}

	let { gate, primaryEvacueeId, members, onnotme, ondone, onbusychange, onstepchange }: Props =
		$props();

	// Each lookup mounts a fresh component, so the session starts from the first props on purpose.
	const session = untrack(
		() =>
			new SelfCheckoutSession(
				{ gate, primaryEvacueeId, members },
				{ checkOut: checkOutKioskMembers }
			)
	);

	const t = $derived(getTranslation(KIOSK_SELF_CHECKOUT_I18N, languageStore.current));
	const flow = $derived(getTranslation(KIOSK_QR_FLOW_I18N, languageStore.current).checkIn);
	const selectedMembers = $derived(
		members.filter((member) => session.selectedIds.includes(member.evacuee_id))
	);
	const checkedOutCount = $derived(
		session.results.filter((result) => result.status === 'checked_out').length
	);
	const allCheckedOut = $derived(
		session.results.length > 0 && checkedOutCount === session.results.length
	);

	$effect(() => {
		onbusychange?.(session.busy);
	});
	// A visit that ends mid-save (the page goes away) must not leave the idle timeout paused.
	$effect(() => () => onbusychange?.(false));
	$effect(() => {
		onstepchange?.(session.step);
	});
	// The done screen hands the kiosk back to the next visitor on its own.
	$effect(() => {
		if (session.step !== 'done') return;
		const timer = window.setInterval(() => session.tick(), 1000);
		return () => window.clearInterval(timer);
	});
	$effect(() => {
		if (session.step === 'done' && session.expired) ondone();
	});

	function fullName(member: Pick<KioskEvacueeSummary, 'first_name' | 'last_name'>): string {
		return [member.first_name, member.last_name].filter(Boolean).join(' ') || flow.noName;
	}

	function nameOf(evacueeId: string): string {
		const person = members.find((member) => member.evacuee_id === evacueeId);
		return person ? fullName(person) : evacueeId;
	}

	function statusLabel(status: string): string {
		return status in flow.status && status !== 'unknown'
			? flow.status[status as keyof typeof flow.status]
			: flow.status.unknown;
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<div data-testid="kiosk-self-checkout" data-step={session.step}>
	{#if session.step === 'ask'}
		<KioskNoticePanel tone="info" icon={LogOut} title={t.ask.title} role="status">
			<p>{t.ask.body}</p>
			{#snippet actions()}
				<Button type="button" onclick={() => session.start()} class={KIOSK_NOTICE_PRIMARY_ACTION}
					><LogOut aria-hidden="true" />{t.ask.confirm}</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={onnotme}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.ask.notMe}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{:else if session.step === 'members'}
		<KioskNoticePanel tone="info" icon={UsersRound} title={t.members.title}>
			<ul class="space-y-3 text-left kiosk-portrait:space-y-4">
				{#each members as member (member.evacuee_id)}
					{@const eligible = isSelfCheckoutEligible(member.status)}
					{@const selected = session.selectedIds.includes(member.evacuee_id)}
					{@const reason = selfCheckoutUnavailableReason(member.status, languageStore.current)}
					<li>
						<!-- The whole row is the tap target: the label forwards taps to the checkbox. -->
						<label
							class={[
								'flex min-h-20 items-center gap-4 rounded-xl border-2 px-4 py-3 kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 kiosk-compact:min-h-16 kiosk-compact:py-2',
								!eligible && 'border-slate-200 bg-slate-50 opacity-75',
								eligible &&
									(selected
										? 'border-[#0A2647] bg-sky-50'
										: 'border-slate-200 bg-white active:bg-slate-50'),
								eligible && 'cursor-pointer'
							]}
						>
							{#if eligible}
								<Checkbox
									checked={selected}
									onCheckedChange={() => session.toggleMember(member.evacuee_id)}
									aria-labelledby={`checkout-name-${member.evacuee_id}`}
									class="size-12 shrink-0 kiosk-compact:size-10"
								/>
							{:else}
								<span class="size-12 shrink-0 kiosk-compact:size-10" aria-hidden="true"></span>
							{/if}
							<div class="min-w-0 flex-1">
								<p
									id={`checkout-name-${member.evacuee_id}`}
									class="truncate text-lg font-bold text-slate-950 sm:text-xl kiosk-portrait:text-2xl kiosk-compact:text-lg"
								>
									{fullName(member)}
									{#if member.is_primary}<span
											class="ml-2 rounded-full bg-[#F0F4F8] px-2 py-1 text-sm font-bold text-[#0A2647] kiosk-portrait:px-3 kiosk-portrait:text-lg kiosk-compact:text-xs"
											>{t.members.holder}</span
										>{/if}
								</p>
								<p
									class="mt-1 text-base text-slate-600 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:text-sm"
								>
									{statusLabel(member.status)}{#if reason}<span class="mx-1" aria-hidden="true"
											>·</span
										>{reason}{/if}
								</p>
							</div>
						</label>
					</li>
				{/each}
			</ul>
			{#snippet actions()}
				<Button
					type="button"
					disabled={!session.canContinue}
					onclick={() => session.next()}
					class={KIOSK_NOTICE_PRIMARY_ACTION}>{t.members.next}</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={() => session.back()}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.members.back}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{:else if session.step === 'destination'}
		<KioskNoticePanel tone="info" icon={MapPin} title={t.destination.title}>
			{#snippet actions()}
				<Button
					type="button"
					onclick={() => session.chooseDestination('returned_home')}
					class={KIOSK_NOTICE_PRIMARY_ACTION}
					><House aria-hidden="true" />{t.destination.home}</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={() => session.chooseDestination('other')}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.destination.other}</Button
				>
				<Button
					type="button"
					variant="ghost"
					onclick={() => session.back()}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.destination.back}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{:else if session.step === 'confirm' || session.step === 'submitting'}
		<KioskNoticePanel
			tone="info"
			icon={ClipboardCheck}
			title={t.confirm.title(selectedMembers.length)}
		>
			<ul class="space-y-2 text-left text-lg font-semibold text-slate-900 kiosk-portrait:text-2xl">
				{#each selectedMembers as member (member.evacuee_id)}
					<li class="rounded-xl border border-slate-200 bg-white px-4 py-3">{fullName(member)}</li>
				{/each}
			</ul>
			<p class="text-lg font-semibold text-slate-900 kiosk-portrait:text-2xl">
				{t.confirm.destinationLabel}:
				{session.destination === 'returned_home' ? t.destination.home : t.destination.other}
			</p>
			{#if session.error}
				<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert"
					>{session.error.message ?? t.errors.generic}</KioskInlineAlert
				>
			{/if}
			{#snippet actions()}
				{#if session.busy}
					<KioskBusyStatus class="w-full">{t.confirm.saving}</KioskBusyStatus>
				{:else if session.error?.terminal}
					<Button type="button" onclick={ondone} class={KIOSK_NOTICE_PRIMARY_ACTION}
						>{t.confirm.home}</Button
					>
				{:else}
					<Button
						type="button"
						onclick={() => void session.confirm()}
						class={KIOSK_NOTICE_PRIMARY_ACTION}
						><CheckCircle2 aria-hidden="true" />{t.confirm.confirm}</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => session.back()}
						class={KIOSK_NOTICE_SECONDARY_ACTION}>{t.confirm.back}</Button
					>
				{/if}
			{/snippet}
		</KioskNoticePanel>
	{:else}
		<KioskNoticePanel
			tone={allCheckedOut ? 'success' : 'warning'}
			icon={allCheckedOut ? CheckCircle2 : CircleAlert}
			title={allCheckedOut
				? t.done.titleAll
				: checkedOutCount > 0
					? t.done.titlePartial
					: t.done.titleNone}
			role="status"
		>
			<ul class="space-y-2 text-left kiosk-portrait:space-y-3">
				{#each session.results as result (result.evacuee_id)}
					{@const done = result.status === 'checked_out'}
					<li
						class={[
							'flex items-center gap-3 rounded-xl border p-4 kiosk-compact:p-3',
							done ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
						]}
					>
						{#if done}
							<CheckCircle2
								class="size-6 shrink-0 text-emerald-800 kiosk-portrait:size-8"
								aria-hidden="true"
							/>
						{:else}
							<CircleAlert
								class="size-6 shrink-0 text-amber-800 kiosk-portrait:size-8"
								aria-hidden="true"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<p
								class="truncate text-lg font-bold text-slate-950 sm:text-xl kiosk-portrait:text-2xl kiosk-compact:text-base"
							>
								{nameOf(result.evacuee_id)}
							</p>
							<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl kiosk-compact:text-sm">
								{done ? t.done.rowDone : t.done.rowContactStaff}
							</p>
						</div>
					</li>
				{/each}
			</ul>
			<p class="text-base text-slate-600 kiosk-portrait:text-xl">
				{t.done.countdown(session.secondsLeft)}
			</p>
			{#snippet actions()}
				<Button type="button" onclick={ondone} class={KIOSK_NOTICE_PRIMARY_ACTION}
					>{t.done.home}</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{/if}
</div>
