<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import Download from '@lucide/svelte/icons/download';
	import Link2 from '@lucide/svelte/icons/link-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { SvelteSet } from 'svelte/reactivity';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { languageStore } from '$lib/stores/language.svelte';
	import { SKILL_MASTER } from '$lib/features/volunteers/domain/skill-master';
	import {
		useCancelTicketMutation,
		useVolunteerSkills,
		useVolunteerTicket
	} from '../application/queries';
	import {
		ticketI18n,
		formatLocalizedDateTime,
		formatLocalizedDate,
		formatLocalizedShiftTime
	} from '../i18n/ticket.i18n';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let cancelDialogOpen = $state(false);

	const t = $derived(ticketI18n[languageStore.current]);
	const currentLang = $derived(languageStore.current);

	const query = useVolunteerTicket(() => token);
	const cancel = useCancelTicketMutation();

	const ticket = $derived(query.data);
	const skillsQuery = useVolunteerSkills(() => ticket?.shelter_code);

	/**
	 * The QR carries the pass URL and nothing else — no name, no phone, no ID number.
	 * The check-in station resolves the token server-side, so anything more on the code
	 * would be PII held up at a shelter gate.
	 */
	const qrPromise = $derived.by(() => {
		if (!ticket) return null;
		try {
			const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
			const fullUrl = new URL(ticket.qr_payload, baseUrl).toString();
			return generateQrDataUrl(fullUrl, {
				width: 512,
				margin: 1,
				color: { dark: '#0f172a', light: '#ffffff' }
			});
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
	});

	const appliedAt = $derived.by(() => {
		if (!ticket?.applied_at) return '';
		return formatLocalizedDateTime(ticket.applied_at, currentLang);
	});

	const formattedShiftDate = $derived.by(() => {
		if (!ticket?.selected_shift?.date) return '';
		return formatLocalizedDate(ticket.selected_shift.date, currentLang, true);
	});

	const formattedShiftTime = $derived.by(() => {
		if (!ticket?.selected_shift?.start_time && !ticket?.selected_shift?.end_time) return '';
		return formatLocalizedShiftTime(
			ticket.selected_shift.start_time,
			ticket.selected_shift.end_time,
			currentLang
		);
	});

	const headerStyle = $derived.by(() => {
		if (ticket?.status === 'confirmed') {
			return {
				bgClass: 'bg-[#047857]',
				badgeClass: 'bg-emerald-400 text-emerald-950',
				emoji: '✅',
				label: t.statusConfirmed
			};
		}
		if (ticket?.status === 'cancelled') {
			return {
				bgClass: 'bg-slate-700',
				badgeClass: 'bg-slate-400 text-slate-900',
				emoji: '⚪',
				label: t.statusCancelled
			};
		}
		if (ticket?.status === 'pending_review') {
			return {
				bgClass: 'bg-[#b45309]',
				badgeClass: 'bg-[#f59e0b] text-amber-950',
				emoji: '⏱️',
				label: t.statusPendingReview
			};
		}
		return {
			bgClass: 'bg-[#0b2447]',
			badgeClass: 'bg-sky-400 text-sky-950',
			emoji: 'ℹ️',
			label: ticket?.status ?? ''
		};
	});

	const renderedSkills = $derived.by(() => {
		if (!ticket?.skills || !Array.isArray(ticket.skills)) return [];
		const masterList = skillsQuery.data ?? [];
		const seen = new SvelteSet<string>();
		const result: { code: string; name: string; icon?: string }[] = [];

		for (const skillCodeOrLabel of ticket.skills) {
			if (!skillCodeOrLabel || seen.has(skillCodeOrLabel)) continue;
			seen.add(skillCodeOrLabel);

			const masterOpt = masterList.find(
				(m) => m.code === skillCodeOrLabel || m.label === skillCodeOrLabel
			);
			const fallbackMaster = SKILL_MASTER.find(
				(s) => s.key === skillCodeOrLabel || s.label === skillCodeOrLabel
			);

			const name = masterOpt?.label ?? fallbackMaster?.label ?? skillCodeOrLabel;
			const icon = fallbackMaster?.icon ?? '';
			result.push({ code: skillCodeOrLabel, name, icon });
		}
		return result;
	});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			toast.success(t.toastCopySuccess);
		} catch {
			toast.error(t.toastCopyError);
		}
	}

	async function downloadQr(dataUrl: string) {
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `volunteer-ticket-${token}.png`;
		link.click();
	}

	async function confirmCancelTicket() {
		try {
			await cancel.mutateAsync(token);
			cancelDialogOpen = false;
			toast.success(t.toastCancelSuccess);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.toastCancelError);
		}
	}
</script>

<div class="mx-auto max-w-xl space-y-4 py-4">
	<!-- Secondary Navigation Bar -->
	<div
		class="flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-medium text-slate-600"
	>
		<Button
			href="/volunteers/jobs"
			variant="outline"
			size="sm"
			class="h-8 rounded-full border-slate-200 bg-white text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
		>
			<ArrowLeft class="mr-1.5 size-3.5" aria-hidden="true" />
			{t.backToJobs}
		</Button>
		<Button
			href="/volunteers/jobs?tab=ticket"
			variant="outline"
			size="sm"
			class="h-8 rounded-full border-slate-200 bg-white text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
		>
			<Search class="mr-1.5 size-3.5" aria-hidden="true" />
			{t.findOtherTicket}
		</Button>
		<div
			class="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-600 shadow-xs"
		>
			<span class="inline-block size-2 animate-pulse rounded-full bg-emerald-500"></span>
			{t.offlineCached}
		</div>
	</div>

	{#if query.isPending}
		<Skeleton class="h-[36rem] w-full rounded-3xl" />
	{:else if query.isError || !ticket}
		<Card.Root class="rounded-3xl border border-slate-200 shadow-sm">
			<Card.Content class="flex flex-col items-center gap-3 py-12 text-center">
				<CircleAlert class="size-8 text-muted-foreground" aria-hidden="true" />
				<p class="text-sm">
					{query.error instanceof Error ? query.error.message : t.notFoundError}
				</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Ticket Pass Card -->
		<div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
			<!-- Card Header -->
			<div class="{headerStyle.bgClass} relative p-6 text-white transition-colors duration-200">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
					<div
						class="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur"
					>
						<span>🛡️</span>
						{t.digitalPassBadge}
					</div>
					<div
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold {headerStyle.badgeClass}"
					>
						<span>{headerStyle.emoji}</span>
						{headerStyle.label}
					</div>
				</div>

				<h1 class="text-xl leading-snug font-bold md:text-2xl">
					{ticket.job_title || t.defaultJobTitle}
				</h1>

				<div class="mt-3 flex items-center gap-1.5 text-xs font-medium text-white/90">
					<Building2 class="size-4 shrink-0" aria-hidden="true" />
					<span>{ticket.shelter_name || ticket.shelter_code || t.shelterDefault}</span>
				</div>

				<!-- Card Token Row -->
				<div class="mt-4 flex items-center justify-between border-t border-white/20 pt-3 text-xs">
					<div>
						<span class="opacity-80">{t.tokenLabel}</span>
						<strong class="ml-1 font-mono text-white">{ticket.token}</strong>
					</div>
					{#if appliedAt}
						<div>
							<span class="opacity-80">{t.appliedAtLabel}</span>
							<strong class="ml-1 text-white">{appliedAt}</strong>
						</div>
					{/if}
				</div>
			</div>

			<!-- Card Body Content -->
			<div class="space-y-4 p-5">
				<!-- Conditional Status Alert Box -->
				{#if ticket.status === 'pending_review'}
					<div class="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs">
						<div
							class="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"
						>
							<Clock class="size-4" aria-hidden="true" />
						</div>
						<div>
							<div class="mb-0.5 font-bold text-amber-900">{t.pendingReviewAlertTitle}</div>
							<p class="leading-relaxed text-amber-800/90">
								{t.pendingReviewAlertDesc}
							</p>
						</div>
					</div>
				{:else if ticket.status === 'confirmed'}
					<div class="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs">
						<div
							class="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
						>
							<CheckCircle2 class="size-4" aria-hidden="true" />
						</div>
						<div>
							<div class="mb-0.5 font-bold text-emerald-900">{t.confirmedAlertTitle}</div>
							<p class="leading-relaxed text-emerald-800/90">
								{t.confirmedAlertDesc}
							</p>
						</div>
					</div>
				{:else if ticket.status === 'cancelled'}
					<div class="flex gap-3 rounded-2xl border border-slate-200 bg-slate-100 p-4 text-xs">
						<div
							class="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"
						>
							<X class="size-4" aria-hidden="true" />
						</div>
						<div>
							<div class="mb-0.5 font-bold text-slate-900">{t.cancelledAlertTitle}</div>
							<p class="leading-relaxed text-slate-700">
								{t.cancelledAlertDesc}
							</p>
						</div>
					</div>
				{/if}

				<!-- QR Code Ticket Section -->
				<div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-6 text-center">
					<div
						class="mb-2 inline-block rounded-full bg-sky-50 px-3 py-0.5 text-[10px] font-extrabold tracking-wide text-sky-700 uppercase"
					>
						{t.onSiteVerificationBadge}
					</div>
					<h2 class="text-sm font-bold text-slate-800">{t.onSiteVerificationTitle}</h2>
					<p class="mt-0.5 text-[11px] text-slate-500">{t.onSiteVerificationSubtitle}</p>

					<div class="my-5 inline-block rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
						{#if qrPromise}
							{#await qrPromise}
								<div class="flex size-40 items-center justify-center">
									<Skeleton class="size-40 rounded-lg" />
								</div>
							{:then dataUrl}
								<img
									src={dataUrl}
									alt={t.qrAlt}
									class="mx-auto size-40 rounded-lg object-contain"
								/>
							{:catch}
								<div class="flex size-40 items-center justify-center text-xs text-muted-foreground">
									{t.qrError}
								</div>
							{/await}
						{/if}
					</div>

					<div class="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
						{t.ticketPassCodeLabel}
					</div>
					<div class="mt-0.5 text-sm font-bold tracking-wider text-slate-800 select-all">
						{ticket.token}
					</div>
				</div>

				<!-- Appointment & Location 2-col Grid -->
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
						<div class="mb-1 flex items-center gap-1.5 font-medium text-slate-500">
							<CalendarDays class="size-3.5 text-slate-500" aria-hidden="true" />
							{t.appointmentTitle}
						</div>
						<div class="text-xs font-bold text-slate-800">
							{formattedShiftDate || '-'}
						</div>
						{#if formattedShiftTime}
							<div class="mt-0.5 flex items-center gap-1 text-slate-600">
								<Clock class="size-3 text-slate-400" aria-hidden="true" />
								{formattedShiftTime}
							</div>
						{/if}
					</div>

					<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
						<div class="mb-1 flex items-center gap-1.5 font-medium text-slate-500">
							<MapPin class="size-3.5 text-slate-500" aria-hidden="true" />
							{t.locationTitle}
						</div>
						<div class="text-xs leading-snug font-bold text-slate-800">
							{ticket.shelter_name || ticket.shelter_code || t.shelterDefault}
						</div>
						{#if ticket.selected_shift?.station}
							<div class="mt-0.5 text-slate-500">{ticket.selected_shift.station}</div>
						{/if}
					</div>
				</div>

				<!-- Volunteer Information -->
				<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
					<div class="mb-1.5 flex items-center gap-1.5 font-medium text-slate-500">
						<User class="size-3.5 text-slate-500" aria-hidden="true" />
						{t.applicantInfoTitle}
					</div>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<div class="font-bold text-slate-800">{ticket.applicant_name}</div>
							<div class="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
								<Phone class="size-3 text-slate-400" aria-hidden="true" />
								{ticket.phone_masked}
							</div>
						</div>
						{#if renderedSkills.length > 0}
							<div class="flex flex-wrap items-center gap-1.5">
								{#each renderedSkills as skill (skill.code)}
									<span
										class="flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] text-sky-700"
									>
										{#if skill.icon}<span>{skill.icon}</span>{/if}
										<span>{skill.name}</span>
									</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- CTA Buttons -->
				<div class="space-y-2 pt-1">
					<div class="grid grid-cols-1 gap-2 md:grid-cols-2">
						{#if qrPromise}
							{#await qrPromise then dataUrl}
								<button
									class="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2447] px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#071933]"
									onclick={() => downloadQr(dataUrl)}
								>
									<Download class="size-4" aria-hidden="true" />
									{t.downloadQrButton}
								</button>
							{/await}
						{/if}
						<button
							class="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50"
							onclick={copyLink}
						>
							<Link2 class="size-4" aria-hidden="true" />
							{t.copyLinkButton}
						</button>
					</div>

					{#if ticket.status !== 'cancelled' && ticket.can_cancel}
						<div class="pt-2 text-center">
							<button
								class="inline-flex items-center gap-1 text-xs font-medium text-rose-500 transition hover:text-rose-700 disabled:opacity-50"
								disabled={cancel.isPending}
								onclick={() => (cancelDialogOpen = true)}
							>
								<CircleAlert class="size-3.5" aria-hidden="true" />
								{t.cancelTicketButton}
							</button>
						</div>
					{/if}
				</div>

				<!-- Travel Guidance Alert Box -->
				<div
					class="mt-4 space-y-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-xs text-slate-700"
				>
					<div class="flex items-center gap-1.5 font-bold text-blue-900">
						<Building2 class="size-4 shrink-0 text-blue-600" aria-hidden="true" />
						{t.travelGuidanceTitle}
					</div>
					<ul
						class="list-inside list-disc space-y-1 pl-1 text-[11.5px] leading-relaxed text-slate-600"
					>
						<li>{t.travelGuidance1}</li>
						<li>{t.travelGuidance2}</li>
						<li>{t.travelGuidance3}</li>
					</ul>
				</div>
			</div>
		</div>

		<!-- Cancellation Confirmation Alert Dialog -->
		<AlertDialog.Root bind:open={cancelDialogOpen}>
			<AlertDialog.Content class="max-w-md rounded-3xl">
				<AlertDialog.Header>
					<AlertDialog.Title class="text-base font-bold text-slate-900">
						{t.cancelModalTitle}
					</AlertDialog.Title>
					<AlertDialog.Description class="text-xs leading-relaxed text-slate-600">
						{t.cancelModalDesc}
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer class="gap-2 sm:gap-0">
					<AlertDialog.Cancel disabled={cancel.isPending} class="rounded-xl text-xs font-semibold">
						{t.cancelModalCancelBtn}
					</AlertDialog.Cancel>
					<AlertDialog.Action
						class="text-destructive-foreground rounded-xl bg-destructive text-xs font-semibold hover:bg-destructive/90"
						disabled={cancel.isPending}
						onclick={(e) => {
							e.preventDefault();
							confirmCancelTicket();
						}}
					>
						{#if cancel.isPending}
							{t.cancelling}
						{:else}
							{t.cancelModalConfirmBtn}
						{/if}
					</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>
	{/if}
</div>
