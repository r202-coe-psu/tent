<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import { useDonationTrackSearch } from '$lib/features/donations';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	// CR-052 §2.6: the donation ticket links here with ref + phone already filled in.
	let bookingRefInput = $state(page.url.searchParams.get('ref') ?? '');
	let phoneInput = $state(page.url.searchParams.get('phone') ?? '');
	const trackSearch = useDonationTrackSearch();

	onMount(() => {
		if (bookingRefInput.trim() && phoneInput.trim()) handleSearch();
	});

	async function handleSearch() {
		const bookingRef = bookingRefInput.trim().toUpperCase();
		const phone = phoneInput.trim();
		if (!bookingRef) {
			toast.error(t.valBookingRefRequired);
			return;
		}
		if (!phone) {
			toast.error(t.valPhoneRequired);
			return;
		}
		try {
			const result = await trackSearch.mutateAsync({ bookingRef, phone });
			goto(resolve(`/donations/track/${encodeURIComponent(result.trackingToken)}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.searchFailed);
		}
	}
</script>

<svelte:head>
	<title>{t.trackPageTitle}</title>
</svelte:head>

<PublicPageShell maxWidth="max-w-5xl">
	<a
		href={resolve('/donations')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		{t.backToDonate}
	</a>

	<div
		class="overflow-hidden rounded-3xl border border-border bg-card p-6 text-foreground shadow-sm md:p-10"
	>
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"
			>
				<QrCode class="h-5 w-5" />
			</div>
			<div>
				<h1 class="text-lg font-bold tracking-tight md:text-xl">{t.trackHeaderTitle}</h1>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{t.trackHeaderSubtitle}
				</p>
			</div>
		</div>

		<div class="space-y-5">
			<div class="space-y-2">
				<label
					for="booking-ref-field"
					class="block text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
				>
					{t.bookingRefFieldLabel}
				</label>
				<Input
					id="booking-ref-field"
					type="text"
					placeholder={t.bookingRefPlaceholder}
					bind:value={bookingRefInput}
					class="h-12 w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 font-mono text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				/>
			</div>
			<div class="space-y-2">
				<label
					for="phone-field"
					class="block text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
				>
					{t.phoneUsedLabel}
				</label>
				<Input
					id="phone-field"
					type="tel"
					inputmode="tel"
					placeholder={t.phoneUsedPlaceholder}
					bind:value={phoneInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') handleSearch();
					}}
					class="h-12 w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				/>
			</div>
			<Button
				onclick={handleSearch}
				disabled={trackSearch.isPending}
				class="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
			>
				<Search class="h-4 w-4" />
				{trackSearch.isPending ? t.trackingLoading : t.trackBtn}
			</Button>
		</div>

		<div class="mt-8 space-y-3 border-t border-border/60 pt-6">
			<div class="flex items-start gap-2.5 text-2xs leading-relaxed text-muted-foreground">
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
