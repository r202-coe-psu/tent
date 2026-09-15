<script lang="ts">
	import Truck from '@lucide/svelte/icons/truck';
	import Clock from '@lucide/svelte/icons/clock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Copy from '@lucide/svelte/icons/copy';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
	import { getDonationStore } from '../../routes/(public)/donations/donation.svelte';
	import { toast } from 'svelte-sonner';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	const donationStore = getDonationStore();
	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	let courierTracking = $state('');
	let savingCourier = $state(false);
	let courierSaved = $state(false);
	let courierError = $state('');
	let isItemsModalOpen = $state(false);
	let isCopied = $state(false);

	// CR-052 §2.6: hand the ref + phone to the track page so it can search on arrival.
	const trackHref = $derived.by(() => {
		const base = resolve('/donations/track');
		const parts: string[] = [];
		if (donationStore.bookingRef) parts.push(`ref=${encodeURIComponent(donationStore.bookingRef)}`);
		if (donationStore.donorPhone)
			parts.push(`phone=${encodeURIComponent(donationStore.donorPhone)}`);
		return parts.length ? `${base}?${parts.join('&')}` : base;
	});

	/**
	 * EVERY public booking opens in `pending_review` — CR-052 §1.4 (Task #52) removed
	 * the path that issued a check-in QR straight away, and FastAPI stamps the status
	 * server-side (`INITIAL_DONATION_STATUS`). So this ticket always shows the waiting
	 * state and never a QR.
	 *
	 * It used to guess with a client-side rule (`shelter_pickup`, total > 500,
	 * unsolicited, or a line with no `item_id`) — so a small booking made from a needs
	 * card got a QR at once while its doc sat in `pending_review`, and the donor arrived
	 * holding a pass no one had approved. That rule WAS the §1.4 violation, and it is
	 * why the ticket and the tracking page disagreed.
	 *
	 * The pass itself comes from the tracking page once staff approve.
	 */

	async function saveCourier() {
		if (!donationStore.trackingToken) return;
		savingCourier = true;
		courierError = '';
		courierSaved = false;
		try {
			const res = await fetch(`/api/public/v1/donations/${donationStore.trackingToken}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courier_tracking_no: courierTracking })
			});
			const data = await res.json();
			if (data.success) {
				courierSaved = true;
				toast.success(t.courierSavedMsg);
			} else {
				courierError = data.error || t.courierErrorMsg;
			}
		} catch {
			courierError = t.errorConnect;
		} finally {
			savingCourier = false;
		}
	}

	function handleCopyRef() {
		const code = donationStore.bookingRef || donationStore.trackingToken;
		if (code) {
			navigator.clipboard.writeText(code);
			isCopied = true;
			toast.success(t.copiedRef);
			setTimeout(() => (isCopied = false), 2000);
		}
	}

	function getDotColor(index: number) {
		const dots = [
			'bg-emerald-500 text-emerald-600',
			'bg-blue-500 text-blue-600',
			'bg-amber-500 text-amber-600',
			'bg-indigo-500 text-indigo-600',
			'bg-rose-500 text-rose-600'
		];
		return dots[index % dots.length];
	}
</script>

<div class="mx-auto w-full max-w-sm animate-in duration-300 fade-in">
	<!-- Ticket Top Part (Voucher Header) -->
	<div
		class="relative space-y-2 overflow-hidden rounded-t-3xl bg-[#ff9f0a] p-6 text-center text-white transition-colors"
	>
		<div
			class="relative z-10 mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-xs"
		>
			<Clock class="h-8 w-8 animate-pulse text-white" />
		</div>
		<h3 class="relative z-10 text-2xl font-bold">
			{t.pendingReviewTitle}
		</h3>
		<p class="relative z-10 text-xs leading-relaxed font-medium text-white/80">
			{t.pendingReviewDesc}
		</p>

		<!-- Decorative background circles -->
		<div
			class="absolute top-[-50px] right-[-50px] h-32 w-32 rounded-full bg-white/10 blur-xl"
		></div>
		<div
			class="absolute bottom-[-20px] left-[-20px] h-24 w-24 rounded-full bg-white/10 blur-xl"
		></div>
	</div>

	<!-- Ticket Bottom Part (Voucher Details with Cutouts) -->
	<div
		class="relative rounded-b-3xl border-x border-b border-slate-200 bg-white p-6 text-center shadow-xl"
	>
		<!-- Ticket cutouts visual design -->
		<div class="absolute -top-4 left-0 flex w-full justify-between px-4">
			<div class="h-8 w-8 rounded-full border border-transparent bg-[#f5f5f7]"></div>
			<div class="h-8 w-8 rounded-full border border-transparent bg-[#f5f5f7]"></div>
		</div>

		<div class="mt-4 mb-6 border-b-2 border-dashed border-slate-200 pb-6">
			<div class="mx-auto mb-4 w-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
				<!-- Where the QR used to be. There is no check-in pass yet: staff have to
				     review the request first (CR-052 §1.4) — the donor gets it on the
				     tracking page once approved. -->
				<div
					class="flex h-[180px] w-[180px] items-center justify-center rounded-xl border-2 border-amber-200/50 bg-amber-50"
				>
					<div class="flex flex-col items-center gap-2 text-center text-amber-600">
						<Clock class="h-10 w-10 animate-pulse" />
						<span class="text-sm font-bold">{t.pendingWarehouse}</span>
					</div>
				</div>
			</div>

			<div class="mb-1 text-2xs font-bold tracking-[0.2em] text-slate-400">{t.refIdLabel}</div>
			<div class="font-mono text-xl font-bold text-slate-800">
				{donationStore.bookingRef || 'DN-XXXXXX'}
			</div>
			<div class="mt-2 text-2xs font-semibold text-slate-400">{t.trackingTokenLabel}</div>
			<div class="font-mono text-xs font-bold text-[#013365] select-all">
				{donationStore.trackingToken || '-'}
			</div>
		</div>

		<div class="space-y-4 text-left">
			<div>
				<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
					<MapPin class="h-3.5 w-3.5" />
					{t.destShelter}
				</div>
				<div class="text-base font-bold text-slate-800">
					{donationStore.selectedShelterName || donationStore.shelterCode || t.centralShelter}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
						<Clock class="h-3.5 w-3.5" />
						{t.appointmentTime}
					</div>
					<div class="text-sm font-bold text-slate-800">
						{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
							{donationStore.slotDate} {donationStore.slotTime}
						{:else}
							{donationStore.eta || t.accordingToDelivery}
						{/if}
					</div>
				</div>
				<div>
					<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
						<ShieldCheck class="h-3.5 w-3.5" />
						{t.queueStatus}
					</div>
					<div class="text-sm font-bold text-amber-600">
						{t.statusPendingReview}
					</div>
				</div>

				<div class="col-span-2 mt-1 border-t border-slate-100 pt-3">
					<div class="mb-2.5 flex items-center justify-between text-xs font-bold text-slate-500">
						<span class="flex items-center gap-1"
							>📦 {t.selectedItemsSummary.replace(
								'{count}',
								String(donationStore.items.length)
							)}</span
						>
						<button
							type="button"
							onclick={() => (isItemsModalOpen = true)}
							class="flex cursor-pointer items-center gap-0.5 text-xs font-black text-[#013481] hover:underline"
						>
							{t.viewAll}
						</button>
					</div>
					<button
						type="button"
						onclick={() => (isItemsModalOpen = true)}
						class="block w-full cursor-pointer space-y-2 pl-1 text-left transition hover:opacity-80"
					>
						{#each donationStore.items.slice(0, 5) as item, index (item.id)}
							{@const dotClass = getDotColor(index)}
							<span class="flex items-center gap-2 text-xs font-bold">
								<span class="h-2 w-2 shrink-0 rounded-full {dotClass.split(' ')[0]}"></span>
								<span class="{dotClass.split(' ')[1]} truncate">
									{item.name || t.unspecified} — {item.amount}
									{item.unit}
								</span>
							</span>
						{/each}
						{#if donationStore.items.length > 5}
							<span class="block pl-4 text-left text-2xs font-black text-primary hover:underline">
								{t.viewAllRemaining.replace('{count}', String(donationStore.items.length - 5))}
							</span>
						{/if}
					</button>
				</div>
			</div>
		</div>

		<!-- วิธีติดตามสถานะการบริจาค (v8.5 Tracking Guide Card) -->
		<div class="mt-8 rounded-2xl border border-slate-200/80 bg-slate-50 p-5 text-left">
			<div class="mb-3 flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
				<ShieldCheck class="h-4 w-4 text-[#013365]" />
				<span>{t.trackingGuideTitle}</span>
			</div>
			<p class="mb-4 text-xs leading-relaxed font-bold text-slate-500">
				{t.trackingGuideDesc}
			</p>

			<div class="mb-4 grid grid-cols-2 gap-3">
				<div
					class="flex min-h-[72px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs"
				>
					<div>
						<span class="mb-0.5 block text-2xs font-bold tracking-wider text-slate-400 uppercase"
							>{t.refIdLabel}</span
						>
						<span class="block truncate font-mono text-sm font-black text-slate-800 select-all">
							{donationStore.bookingRef || 'DN-XXXXXX'}
						</span>
					</div>
					<div class="mt-2 flex items-center justify-between">
						<button
							type="button"
							onclick={handleCopyRef}
							class="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-2xs font-bold transition-all duration-200 {isCopied
								? 'border-emerald-200 bg-emerald-50 text-emerald-600'
								: 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-[#013365]'}"
						>
							<Copy class="h-3 w-3" />
							{isCopied ? t.copiedBtn : t.copyCodeBtn}
						</button>
					</div>
				</div>

				<div
					class="flex min-h-[72px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs"
				>
					<div>
						<span class="mb-0.5 block text-2xs font-bold tracking-wider text-slate-400 uppercase"
							>{t.phoneLabel}</span
						>
						<span class="block truncate text-sm font-black text-slate-800 select-all">
							{donationStore.donorPhone || t.unspecified}
						</span>
					</div>
					<span class="mt-2 block text-2xs font-medium text-slate-400">{t.usedForTracking}</span>
				</div>
			</div>

			<a
				href={trackHref}
				class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#013365] py-3 text-xs font-bold text-white shadow-xs transition-all duration-200 hover:bg-[#013365]/90"
			>
				<Search class="h-3.5 w-3.5" />
				{t.checkMyDonationStatus}
			</a>
		</div>

		<!-- DN-6: courier tracking update for parcel method -->
		{#if donationStore.deliveryMethod === 'parcel'}
			<div class="mt-6 mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
				<div class="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700">
					<Truck class="h-4 w-4 text-slate-500" />
					{t.parcelCourierGuide}
				</div>
				<div class="flex items-center gap-2">
					<Input
						type="text"
						placeholder={t.parcelCourierPlaceholder}
						bind:value={courierTracking}
						class="flex-1 rounded-xl border-2 border-slate-200"
					/>
					<Button
						onclick={saveCourier}
						disabled={savingCourier || !courierTracking.trim()}
						class="shrink-0 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
					>
						{savingCourier ? t.savingCourierBtn : t.saveCourierBtn}
					</Button>
				</div>
				{#if courierSaved}
					<p class="mt-2 text-2xs font-bold text-emerald-600">{t.courierSavedMsg}</p>
				{/if}
				{#if courierError}
					<p class="mt-2 text-2xs font-bold text-red-500">{courierError}</p>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => toast.success(t.openingMapsToast)}
			class="mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 py-4 text-sm font-bold text-white shadow-md transition-colors hover:bg-slate-800"
		>
			<Navigation class="h-4.5 w-4.5" />
			{t.navigateGoogleMaps}
		</button>

		<button
			type="button"
			onclick={() => donationStore.reset()}
			class="mt-3 w-full cursor-pointer rounded-xl py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-100"
		>
			{t.backToHome}
		</button>
	</div>
</div>

<!-- Items Modal Dialog -->
{#if isItemsModalOpen}
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-200 fade-in"
	>
		<div
			class="flex max-h-[80vh] w-full max-w-md animate-in flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white text-left shadow-2xl duration-200 zoom-in-95"
		>
			<!-- Header -->
			<div class="flex shrink-0 items-center justify-between bg-slate-900 p-5 text-white">
				<div class="flex items-center gap-2">
					<Package class="h-5 w-5 text-white" />
					<h4 class="text-lg font-black tracking-tight">{t.allItemsModalTitle}</h4>
				</div>
				<button
					type="button"
					onclick={() => (isItemsModalOpen = false)}
					class="cursor-pointer rounded-lg p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
					aria-label={t.closeModalAria}
				>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 space-y-4 overflow-y-auto p-6">
				<div
					class="border-b border-slate-100 pb-1 text-xs font-bold tracking-wider text-slate-400 uppercase"
				>
					{t.selectedItemsSummary.replace('{count}', String(donationStore.items.length))}
				</div>
				<div class="divide-y divide-slate-100">
					{#each donationStore.items as item, index (item.id)}
						{@const dotClass = getDotColor(index)}
						<div class="flex items-start gap-3 py-3 text-left first:pt-0 last:pb-0">
							<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {dotClass.split(' ')[0]}"
							></span>
							<div class="flex-1 space-y-0.5">
								<div class="flex items-baseline justify-between gap-2">
									<span class="text-sm font-black text-slate-800">
										{item.name || t.unspecified}
									</span>
									<span
										class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-800"
									>
										{item.amount}
										{item.unit}
									</span>
								</div>
								<div
									class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500"
								>
									<span
										>{t.conditionPrefix}: {item.condition === 'new'
											? t.conditionNew
											: item.condition === 'used'
												? t.conditionUsed
												: t.unspecified}</span
									>
									{#if item.remark}
										<span class="text-slate-300">|</span>
										<span class="font-medium text-slate-500 italic">"{item.remark}"</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Footer -->
			<div class="flex shrink-0 justify-end border-t border-slate-100 bg-slate-50 p-4">
				<button
					type="button"
					onclick={() => (isItemsModalOpen = false)}
					class="cursor-pointer rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
				>
					{t.closeModalBtn}
				</button>
			</div>
		</div>
	</div>
{/if}
