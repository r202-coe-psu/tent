<script lang="ts">
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import {
		DonationLookupError,
		type DonationLookupErrorCode,
		donationStatusLabel,
		formatTrackTimestamp,
		isTerminalDonationStatus,
		lookupItemSchedule,
		maskLookupPhone,
		useDonationPhoneLookup,
		useDonationTrackSearch,
		type DonationLookupItem
	} from '$lib/features/donations';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { executeRecaptcha } from '$lib/api/recaptcha-script';
	import { fetchRecaptchaEnabled } from '$lib/api/recaptcha-status';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const locale = $derived(langState.current === 'en' ? 'en' : 'th');
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';

	// Tickets issued before CR-173 linked here with `?ref&phone`. Fill the form from them
	// once — no auto-submit, so an old link never searches on its own (FR-12).
	let bookingRefInput = $state(page.url.searchParams.get('ref') ?? '');
	let phoneInput = $state(page.url.searchParams.get('phone') ?? '');
	/** The last phone search: its number (masked for display) and what it found. */
	let lookup = $state.raw<{ phone: string; items: DonationLookupItem[] } | null>(null);

	const trackSearch = useDonationTrackSearch();
	const phoneLookup = useDonationPhoneLookup();
	const isSearching = $derived(trackSearch.isPending || phoneLookup.isPending);

	// …then take the number out of the address bar and history. `afterNavigate`, not
	// `onMount`: replaceState throws until the router is up, and this runs once it is.
	afterNavigate(() => {
		const params = page.url.searchParams;
		if (params.has('ref') || params.has('phone')) {
			replaceState(resolve('/donations/track'), page.state);
		}
	});

	async function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		const bookingRef = bookingRefInput.trim().toUpperCase();
		const phone = phoneInput.trim();
		if (!phone) {
			toast.error(t.valPhoneRequired);
			return;
		}
		if (bookingRef) {
			await openByRef(bookingRef, phone);
			return;
		}
		await searchByPhone(phone);
	}

	async function openByRef(bookingRef: string, phone: string) {
		try {
			const result = await trackSearch.mutateAsync({ bookingRef, phone });
			goto(resolve(`/donations/track/${encodeURIComponent(result.trackingToken)}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.searchFailed);
		}
	}

	async function searchByPhone(phone: string) {
		try {
			lookup = { phone, items: await lookupWithCaptcha(phone) };
		} catch (err) {
			lookup = null;
			toast.error(lookupErrorMessage(err));
		}
	}

	function lookupErrorMessage(err: unknown): string {
		if (err instanceof DonationLookupError) {
			const messages: Record<DonationLookupErrorCode, string> = {
				CAPTCHA_REQUIRED: t.lookupErrCaptchaRequired,
				CAPTCHA_FAILED: t.lookupErrCaptchaFailed,
				INVALID_PHONE: t.lookupErrInvalidPhone,
				RATE_LIMITED: t.lookupErrRateLimited
			};
			return messages[err.code];
		}
		return err instanceof Error ? err.message : t.searchFailed;
	}

	/**
	 * Every phone search carries a captcha while reCAPTCHA is on (CR-173 FR-8), so the token is
	 * fetched before the first request. The status read can be stale — the operator may have
	 * switched it on since — so a demand from the BFF gets one retry with a fresh token.
	 */
	async function lookupWithCaptcha(phone: string): Promise<DonationLookupItem[]> {
		const captchaToken = (await fetchRecaptchaEnabled()) ? await freshCaptchaToken() : undefined;
		try {
			return await phoneLookup.mutateAsync({ phone, captchaToken });
		} catch (err) {
			const demanded = err instanceof DonationLookupError && err.code === 'CAPTCHA_REQUIRED';
			if (!demanded || captchaToken) throw err;
			return await phoneLookup.mutateAsync({ phone, captchaToken: await freshCaptchaToken() });
		}
	}

	async function freshCaptchaToken(): Promise<string> {
		const token = await executeRecaptcha(siteKey, 'donation_lookup');
		if (!token) throw new Error(t.lookupCaptchaUnavailable);
		return token;
	}
</script>

<svelte:head>
	<title>{t.trackPageTitle}</title>
</svelte:head>

<PublicPageShell maxWidth="max-w-7xl" class="lg:px-8">
	<a
		href={resolve('/donations')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		{t.backToDonate}
	</a>

	<div
		class="overflow-hidden rounded-2xl border border-border bg-card p-6 text-foreground shadow-2xs md:p-10"
	>
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-xl bg-domain-donation-subtle text-domain-donation"
			>
				<QrCode class="h-5 w-5" />
			</div>
			<div>
				<h1 class="text-lg font-bold tracking-tight md:text-xl">{t.trackHeaderTitle}</h1>
				<p class="mt-0.5 text-sm text-muted-foreground">
					{t.trackHeaderSubtitle}
				</p>
			</div>
		</div>

		<form method="POST" class="space-y-5" onsubmit={handleSearch}>
			<div class="space-y-2">
				<Label for="phone-field" class="text-sm font-semibold text-slate-700">
					{t.phoneUsedLabel} <span class="text-red-600">*</span>
				</Label>
				<Input
					id="phone-field"
					name="phone"
					type="tel"
					inputmode="tel"
					autocomplete="tel"
					placeholder={t.phoneUsedPlaceholder}
					bind:value={phoneInput}
					class="h-12 w-full rounded-lg text-base tabular-nums"
				/>
			</div>
			<div class="space-y-2">
				<Label for="booking-ref-field" class="text-sm font-semibold text-slate-700">
					{t.bookingRefFieldLabel}
				</Label>
				<Input
					id="booking-ref-field"
					name="booking_ref"
					type="text"
					autocomplete="off"
					placeholder={t.bookingRefPlaceholder}
					aria-describedby="booking-ref-hint"
					bind:value={bookingRefInput}
					class="h-12 w-full rounded-lg text-base tabular-nums"
				/>
				<p id="booking-ref-hint" class="text-xs text-slate-500">{t.bookingRefHint}</p>
			</div>
			<Button
				type="submit"
				disabled={isSearching}
				class="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-domain-donation-strong px-5 py-3 text-sm font-bold text-white shadow-2xs transition-colors hover:bg-domain-donation-text focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				<Search class="h-4 w-4" />
				{isSearching ? t.trackingLoading : t.trackBtn}
			</Button>
		</form>

		<!-- Always rendered: a live region added together with its content is not announced. -->
		<div aria-live="polite">
			{#if lookup}
				<section class="mt-8 space-y-3 border-t border-border/60 pt-6">
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-base font-bold text-slate-900">
							{t.lookupResultsTitle.replace('{phone}', maskLookupPhone(lookup.phone))}
						</h2>
						<span class="text-sm text-slate-500 tabular-nums">
							{t.lookupResultsCount.replace('{count}', String(lookup.items.length))}
						</span>
					</div>

					{#if lookup.items.length === 0}
						<div
							class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700"
						>
							<Inbox class="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
							<div>
								<p class="text-sm font-semibold text-slate-900">{t.lookupEmptyTitle}</p>
								<p class="mt-1 text-sm text-slate-600">{t.lookupEmptyDesc}</p>
							</div>
						</div>
					{:else}
						<ul class="space-y-3">
							{#each lookup.items as item (item.tracking_token)}
								<li>
									<a
										href={resolve(`/donations/track/${encodeURIComponent(item.tracking_token)}`)}
										class="group flex min-h-11 items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs transition-colors hover:border-domain-donation-border hover:bg-domain-donation-subtle focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:p-5"
									>
										<div class="min-w-0 flex-1 space-y-2">
											<div class="flex flex-wrap items-center gap-2">
												<span class="text-base font-bold text-slate-900 tabular-nums">
													{item.booking_ref}
												</span>
												<span
													class={[
														'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
														isTerminalDonationStatus(item.status)
															? 'border-slate-200 bg-slate-100 text-slate-700'
															: 'border-sky-200 bg-sky-50 text-sky-900'
													]}
												>
													{donationStatusLabel(item.status, locale)}
												</span>
											</div>
											<dl class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
												<div class="flex gap-2">
													<dt class="text-slate-500">{t.lookupShelterLabel}</dt>
													<dd class="truncate font-medium text-slate-800">
														{item.shelter_name ?? item.shelter_code}
													</dd>
												</div>
												<div class="flex gap-2">
													<dt class="text-slate-500">{t.lookupScheduleLabel}</dt>
													<dd class="font-medium text-slate-800 tabular-nums">
														{lookupItemSchedule(item, locale)}
													</dd>
												</div>
												<div class="flex gap-2">
													<dt class="text-slate-500">{t.lookupItemsLabel}</dt>
													<dd class="font-medium text-slate-800 tabular-nums">
														{t.lookupItemsCount.replace('{count}', String(item.item_count))}
													</dd>
												</div>
												<div class="flex gap-2">
													<dt class="text-slate-500">{t.lookupBookedAt}</dt>
													<dd class="font-medium text-slate-800 tabular-nums">
														{formatTrackTimestamp(item.created_at, locale)}
													</dd>
												</div>
											</dl>
										</div>
										<span
											class="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-domain-donation-text"
										>
											<span class="hidden sm:inline">{t.lookupOpenTicket}</span>
											<ChevronRight class="h-4 w-4" />
											<span class="sr-only sm:hidden">{t.lookupOpenTicket}</span>
										</span>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</div>

		<div class="mt-8 space-y-3 border-t border-border/60 pt-6">
			<div class="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
				<AlertCircle class="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" />
				<div>
					<span class="font-bold text-foreground">{t.whyPhoneTitle}</span>
					<p class="mt-1">
						{t.whyPhoneDesc1}
					</p>
					<p class="mt-1">
						{t.whyPhoneDesc2}
					</p>
				</div>
			</div>
		</div>
	</div>
</PublicPageShell>
