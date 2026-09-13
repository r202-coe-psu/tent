<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Calendar from '@lucide/svelte/icons/calendar';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Truck from '@lucide/svelte/icons/truck';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Download from '@lucide/svelte/icons/download';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import {
		useDonationTracking,
		useUpdateCourierTracking,
		donationStatusLabel,
		deliveryMethodLabel,
		vehicleLabel,
		formatTrackTimestamp,
		formatTrackSchedule,
		canEditCourierTracking,
		canCancelDonation,
		CancelDonationDialog,
		EditDonationItemsDialog
	} from '$lib/features/donations';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	let { data }: { data: { token: string } } = $props();
	const token = $derived(data.token);
	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	const trackingQuery = useDonationTracking(() => token);
	const courierMutation = useUpdateCourierTracking();

	let courierInput = $state('');
	let cancelOpen = $state(false);
	let editOpen = $state(false);

	const donation = $derived(trackingQuery.data);
	const isLoading = $derived(trackingQuery.isPending);
	const isError = $derived(trackingQuery.isError);
	const errorMessage = $derived(
		trackingQuery.error instanceof Error ? trackingQuery.error.message : t.loadingStatus
	);

	const status = $derived(donation?.status ?? '');

	/**
	 * CR-052 §1.4 (Task #52) — "ยกเลิกกลไกการข้ามขั้นตอนไปออกรหัสตอบรับ (QR Code)
	 * อัตโนมัติทุกกรณี": a booking gets no check-in pass until staff have reviewed it.
	 * So the QR appears at `verifying` (approved, goods still to come) and nowhere
	 * earlier — which is exactly what the back-office button "อนุมัติรับ (Generate QR)"
	 * promises, and what the wizard's ticket says while it waits.
	 *
	 * It is NOT shown at `received` either: the caption asks the donor to bring the
	 * goods, which read as an outstanding instruction under a line saying staff had
	 * already shelved them.
	 *
	 * (Briefly shown from `pending_review` on 2026-09-01 — reverted the same day: it
	 * contradicts §1.4, and the wizard ticket only appeared to do the same because of a
	 * client-side heuristic that was itself the violation.)
	 */
	const showQr = $derived(status === 'verifying');
	const isReceived = $derived(status === 'received');
	let qrCodeUrl = $state('');

	$effect(() => {
		if (!showQr) {
			qrCodeUrl = '';
			return;
		}
		let cancelled = false;
		QRCode.toDataURL(token, { margin: 1, width: 256 })
			.then((url) => {
				if (!cancelled) qrCodeUrl = url;
			})
			.catch(() => {
				if (!cancelled) qrCodeUrl = '';
			});
		return () => {
			cancelled = true;
		};
	});

	function downloadQr() {
		if (!qrCodeUrl) return;
		const link = document.createElement('a');
		link.href = qrCodeUrl;
		link.download = `QR-${donation?.booking_ref ?? token}.png`;
		link.click();
		toast.success(t.savedQrToast);
	}
	const showCourierEdit = $derived(
		donation ? canEditCourierTracking(donation.status, donation.logistics) : false
	);
	const showCancel = $derived(donation ? canCancelDonation(donation.status) : false);
	// Same gate as cancelling: while it is only a reservation the donor still owns it
	// (CR-080 — the owner settled on `declared` only).
	const showEdit = $derived(showCancel);

	async function saveCourier() {
		const value = courierInput.trim();
		if (!value) {
			toast.error(
				langState.current === 'en' ? 'Please enter tracking number' : 'กรุณากรอกเลขพัสดุ'
			);
			return;
		}
		try {
			await courierMutation.mutateAsync({ token, courierTrackingNo: value });
			toast.success(t.savedCourierToast);
			await trackingQuery.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.errorSavedCourier);
		}
	}

	function statusBadgeClass(s: string): string {
		if (s === 'received') return 'border-success/20 bg-success/10 text-success';
		if (s === 'cancelled' || s === 'expired' || s === 'rejected')
			return 'border-zinc-500/20 bg-zinc-500/10 text-zinc-500';
		if (s === 'pending_review' || s === 'verifying' || s === 'redirected')
			return 'border-warning/20 bg-warning/10 text-warning';
		return 'border-primary/20 bg-primary/10 text-primary';
	}
</script>

<svelte:head>
	<title>{t.trackDetailTitle}</title>
</svelte:head>

<PublicPageShell maxWidth="max-w-5xl">
	<a
		href={resolve('/donations/track')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		{t.backToSearch}
	</a>

	{#if isLoading}
		<div
			class="flex items-center justify-center gap-3 rounded-3xl border border-border bg-card p-12 text-sm text-muted-foreground"
		>
			<LoaderCircle class="h-5 w-5 animate-spin" />
			{t.loadingStatus}
		</div>
	{:else if isError}
		<div class="rounded-3xl border border-danger-border bg-card p-8 text-center shadow-sm">
			<div
				class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger"
			>
				<AlertCircle class="h-6 w-6" />
			</div>
			<h2 class="text-base font-bold text-foreground">{t.notFoundTitle}</h2>
			<p class="mt-2 text-xs text-muted-foreground">{errorMessage}</p>
			<p class="mt-1 font-mono text-2xs break-all text-muted-foreground">{token}</p>
			<a
				href={resolve('/donations/track')}
				class="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"
			>
				{t.searchAgain}
			</a>
		</div>
	{:else if donation}
		<div class="overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-sm">
			<div
				class="flex flex-col gap-4 border-b border-border/20 bg-zinc-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<div class="flex items-center gap-2">
						<QrCode class="h-4.5 w-4.5 text-primary" />
						<span class="text-xs font-medium text-zinc-400">{t.bookingRefFieldLabel}</span>
					</div>
					<h2 class="mt-1 text-xl font-extrabold text-white">
						{donation.booking_ref ?? '—'}
					</h2>
					<p class="mt-1 font-mono text-2xs break-all text-zinc-500">{token}</p>
				</div>
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-bold {statusBadgeClass(
						status
					)}"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
					{donationStatusLabel(status, langState.current)}
				</span>
			</div>

			<div class="space-y-8 p-6 md:p-8">
				{#if isReceived}
					<div
						class="flex flex-col items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-50/60 p-6 text-center dark:bg-emerald-950/20"
					>
						<PackageCheck class="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
						<h4 class="text-sm font-bold text-emerald-800 dark:text-emerald-300">
							{t.receivedTitle}
						</h4>
						<p class="max-w-xs text-2xs text-emerald-800/80 dark:text-emerald-200/80">
							{t.receivedBody}
						</p>
					</div>
				{/if}

				{#if showQr && qrCodeUrl}
					<div
						class="flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/30 p-6 text-center"
					>
						<h4 class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase">
							{t.qrTitle}
						</h4>
						<img
							src={qrCodeUrl}
							alt="QR Code for {donation.booking_ref ?? token}"
							class="h-44 w-44 rounded-xl bg-white p-2 shadow-sm"
						/>
						<Button type="button" variant="outline" size="sm" onclick={downloadQr}>
							<Download class="h-3.5 w-3.5" />
							{t.saveQrBtn}
						</Button>
						<p class="max-w-xs text-2xs text-muted-foreground">
							{t.qrHint}
						</p>
					</div>
				{/if}

				<div class="space-y-4">
					<h4 class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase">
						{t.timelineTitle}
					</h4>
					<div
						class="relative space-y-5 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-0.5 before:bg-border/60"
					>
						<div class="relative flex gap-4">
							<div
								class="absolute -left-[20px] z-10 h-3 w-3 rounded-full border-2 border-primary bg-primary"
							></div>
							<div class="text-xs">
								<span class="font-bold text-foreground">{t.stepSubmitted}</span>
								<p class="mt-0.5 text-2xs text-muted-foreground">
									{t.lastUpdated}
									{formatTrackTimestamp(donation.updated_at, langState.current)}
								</p>
							</div>
						</div>
						{#if status === 'pending_review' || status === 'verifying'}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 h-3 w-3 animate-pulse rounded-full border-2 border-warning bg-warning"
								></div>
								<div class="text-xs">
									<span class="font-bold text-warning"
										>{donationStatusLabel(status, langState.current)}</span
									>
									<p class="mt-0.5 text-2xs text-muted-foreground">
										{t.staffProcessing}
									</p>
								</div>
							</div>
						{/if}
						{#if status === 'cancelled' || status === 'expired' || status === 'rejected'}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 h-3 w-3 rounded-full border-2 border-danger bg-danger"
								></div>
								<div class="text-xs">
									<span class="font-bold text-danger"
										>{donationStatusLabel(status, langState.current)}</span
									>
								</div>
							</div>
						{:else}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 h-3 w-3 rounded-full border-2 {status ===
									'received'
										? 'border-success bg-success'
										: 'border-border bg-card'}"
								></div>
								<div class="text-xs {status !== 'received' ? 'opacity-50' : ''}">
									<span class="font-bold text-foreground">{t.stepReceived}</span>
									{#if donation.received_summary?.received_at}
										<p class="mt-0.5 text-2xs text-muted-foreground">
											{formatTrackTimestamp(
												donation.received_summary.received_at,
												langState.current
											)}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<div class="space-y-4">
						<h4 class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase">
							{t.donorAndScheduleTitle}
						</h4>
						<div class="space-y-3.5 rounded-2xl border border-border bg-card p-4 text-xs">
							<div class="flex gap-2.5">
								<User class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-2xs font-bold text-muted-foreground uppercase"
										>{t.donorLabel}</span
									>
									<p class="mt-0.5 font-bold text-foreground">
										{donation.donor.name ?? t.noData}
									</p>
									{#if donation.donor.phone_masked}
										<p class="text-2xs text-muted-foreground">
											{t.phonePrefix}
											{donation.donor.phone_masked}
										</p>
									{/if}
								</div>
							</div>
							<div class="flex gap-2.5">
								<Calendar class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-2xs font-bold text-muted-foreground uppercase"
										>{t.deliveryScheduleLabel}</span
									>
									<p class="mt-0.5 font-semibold text-foreground">
										{formatTrackSchedule(donation.logistics, langState.current)}
									</p>
									{#if donation.expires_at}
										<p class="mt-0.5 text-2xs text-muted-foreground">
											{t.expiresAt}
											{formatTrackTimestamp(donation.expires_at, langState.current)}
										</p>
									{/if}
								</div>
							</div>
							<div class="flex gap-2.5">
								<MapPin class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-2xs font-bold text-muted-foreground uppercase"
										>{t.destinationShelterLabel}</span
									>
									<p class="mt-0.5 font-semibold text-foreground">{donation.shelter_code}</p>
									<p class="mt-0.5 text-2xs text-muted-foreground">
										{deliveryMethodLabel(donation.logistics?.delivery_method, langState.current)}
										{#if donation.logistics?.vehicle}
											· {vehicleLabel(donation.logistics.vehicle, langState.current)}
										{/if}
									</p>
									{#if donation.logistics?.pickup_address}
										<p class="mt-1 text-2xs text-muted-foreground">
											{langState.current === 'en' ? 'Pickup Address:' : 'จุดรับ:'}
											{donation.logistics.pickup_address}
										</p>
									{/if}
								</div>
							</div>
							{#if donation.logistics?.delivery_method === 'parcel'}
								<div class="flex gap-2.5">
									<Truck class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
									<div class="min-w-0 flex-1">
										<span class="text-2xs font-bold text-muted-foreground uppercase"
											>{t.courierTrackingLabel}</span
										>
										{#if showCourierEdit}
											<div class="mt-1.5 flex flex-col gap-2 sm:flex-row">
												<Input
													bind:value={courierInput}
													placeholder={donation.logistics?.courier_tracking_no ||
														(langState.current === 'en' ? 'Enter tracking no.' : 'กรอกเลขพัสดุ')}
													class="h-9 rounded-xl text-xs"
												/>
												<Button
													onclick={saveCourier}
													disabled={courierMutation.isPending}
													class="h-9 shrink-0 rounded-xl px-3 text-xs font-bold"
												>
													{courierMutation.isPending ? t.saving : t.saveBtn}
												</Button>
											</div>
										{:else}
											<p class="mt-0.5 font-semibold text-foreground">
												{donation.logistics.courier_tracking_no || t.noData}
											</p>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>

					<div class="space-y-4">
						<h4 class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase">
							{t.itemsListTitle}
						</h4>
						<div class="overflow-hidden rounded-2xl border border-border bg-card text-xs">
							{#if donation.items.length === 0}
								<div class="flex items-center gap-2 p-4 text-muted-foreground">
									<Package class="h-4 w-4" />
									{langState.current === 'en' ? 'No donation items' : 'ไม่มีรายการสิ่งของ'}
								</div>
							{:else}
								<table class="w-full border-collapse text-left">
									<thead>
										<tr
											class="border-b border-border bg-muted/30 text-2xs font-bold text-muted-foreground uppercase"
										>
											<th class="px-4 py-2.5">{t.editItemLabel}</th>
											<th class="px-4 py-2.5 text-right">{t.amountLabel}</th>
											<th class="px-4 py-2.5">{t.unitLabel}</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-border/60 font-semibold text-foreground">
										{#each donation.items as item, i (item.item_name + String(i))}
											<tr>
												<td class="px-4 py-3">{item.item_name}</td>
												<td class="px-4 py-3 text-right">
													{item.qty != null
														? Number(item.qty).toLocaleString(
																langState.current === 'en' ? 'en-US' : 'th-TH'
															)
														: t.noData}
												</td>
												<td class="px-4 py-3 text-muted-foreground">{item.unit ?? t.noData}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{/if}
						</div>
					</div>

					{#if showEdit}
						<div class="flex flex-col gap-2 border-t border-border pt-5">
							<Button
								variant="outline"
								onclick={() => (editOpen = true)}
								class="h-10 rounded-xl text-xs font-bold"
							>
								<Pencil class="h-4 w-4" />
								{t.editItemsBtn}
							</Button>
							<p class="text-2xs leading-relaxed text-muted-foreground">
								{langState.current === 'en'
									? 'Adjust quantity or add/remove items until staff begins check-in'
									: 'ปรับจำนวนหรือเพิ่ม-ลบรายการได้จนกว่าเจ้าหน้าที่จะเริ่มตรวจรับ'}
								{#if donation.revisions.length}
									· {langState.current === 'en'
										? `Edited ${donation.revisions.length} times`
										: `แก้ไขแล้ว ${donation.revisions.length} ครั้ง`}
								{/if}
							</p>
						</div>
					{/if}

					{#if showCancel}
						<div class="flex flex-col gap-2 border-t border-border pt-5">
							<Button
								variant="outline"
								onclick={() => (cancelOpen = true)}
								class="h-10 rounded-xl border-destructive/40 text-xs font-bold text-destructive hover:bg-destructive/10 hover:text-destructive"
							>
								<Ban class="h-4 w-4" />
								{t.cancelDonationBtn}
							</Button>
							<p class="text-2xs leading-relaxed text-muted-foreground">
								{langState.current === 'en'
									? 'Once cancelled, the reserved quota will be immediately released to other donors and cannot be undone'
									: 'ยกเลิกแล้วจำนวนที่จองไว้จะถูกคืนให้ผู้บริจาคท่านอื่นทันที และย้อนกลับไม่ได้'}
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Mounted only while open so the edit draft is seeded fresh from the booking
		     each time, rather than an effect syncing props into state behind the user. -->
		{#if editOpen}
			<EditDonationItemsDialog
				bind:open={editOpen}
				{token}
				shelterCode={donation.shelter_code}
				items={donation.items}
				onSaved={() => trackingQuery.refetch()}
			/>
		{/if}

		<CancelDonationDialog
			bind:open={cancelOpen}
			{token}
			bookingRef={donation.booking_ref}
			onCancelled={() => trackingQuery.refetch()}
		/>
	{/if}
</PublicPageShell>
