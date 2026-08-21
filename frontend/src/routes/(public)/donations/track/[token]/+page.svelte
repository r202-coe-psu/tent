<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Calendar from '@lucide/svelte/icons/calendar';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import Truck from '@lucide/svelte/icons/truck';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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

	let { data }: { data: { token: string } } = $props();
	const token = $derived(data.token);

	const trackingQuery = useDonationTracking(() => token);
	const courierMutation = useUpdateCourierTracking();

	let courierInput = $state('');
	let cancelOpen = $state(false);
	let editOpen = $state(false);

	const donation = $derived(trackingQuery.data);
	const isLoading = $derived(trackingQuery.isPending);
	const isError = $derived(trackingQuery.isError);
	const errorMessage = $derived(
		trackingQuery.error instanceof Error
			? trackingQuery.error.message
			: 'ไม่สามารถโหลดสถานะบริจาคได้'
	);

	const status = $derived(donation?.status ?? '');
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
			toast.error('กรุณากรอกเลขพัสดุ');
			return;
		}
		try {
			await courierMutation.mutateAsync({ token, courierTrackingNo: value });
			toast.success('บันทึกเลขพัสดุแล้ว');
			await trackingQuery.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกเลขพัสดุไม่สำเร็จ');
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
	<title>รายละเอียดสถานะของบริจาค — Smart Shelter</title>
</svelte:head>

<PublicPageShell>
	<a
		href={resolve('/donations/track')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		กลับหน้ารายการค้นหา
	</a>

	{#if isLoading}
		<div
			class="flex items-center justify-center gap-3 rounded-3xl border border-border bg-card p-12 text-sm text-muted-foreground"
		>
			<LoaderCircle class="h-5 w-5 animate-spin" />
			กำลังโหลดสถานะบริจาค…
		</div>
	{:else if isError}
		<div class="rounded-3xl border border-danger-border bg-card p-8 text-center shadow-sm">
			<div
				class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger"
			>
				<AlertCircle class="h-6 w-6" />
			</div>
			<h2 class="text-base font-bold text-foreground">ไม่พบรายการบริจาค</h2>
			<p class="mt-2 text-xs text-muted-foreground">{errorMessage}</p>
			<p class="mt-1 font-mono text-[11px] break-all text-muted-foreground">{token}</p>
			<a
				href={resolve('/donations/track')}
				class="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"
			>
				ค้นหาใหม่
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
						<span class="text-xs font-medium text-zinc-400">รหัสอ้างอิง (Booking Ref)</span>
					</div>
					<h2 class="mt-1 text-xl font-extrabold text-white">
						{donation.booking_ref ?? '—'}
					</h2>
					<p class="mt-1 font-mono text-[10px] break-all text-zinc-500">{token}</p>
				</div>
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-bold {statusBadgeClass(
						status
					)}"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
					{donationStatusLabel(status)}
				</span>
			</div>

			<div class="space-y-8 p-6 md:p-8">
				<div class="space-y-4">
					<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
						ไทม์ไลน์สถานะ
					</h4>
					<div
						class="relative space-y-5 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-0.5 before:bg-border/60"
					>
						<div class="relative flex gap-4">
							<div
								class="absolute -left-[20px] z-10 h-3 w-3 rounded-full border-2 border-primary bg-primary"
							></div>
							<div class="text-xs">
								<span class="font-bold text-foreground">ส่งข้อมูลบริจาคเข้าสู่ระบบ</span>
								<p class="mt-0.5 text-[10px] text-muted-foreground">
									อัปเดตล่าสุด {formatTrackTimestamp(donation.updated_at)}
								</p>
							</div>
						</div>
						{#if status === 'pending_review' || status === 'verifying'}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 h-3 w-3 animate-pulse rounded-full border-2 border-warning bg-warning"
								></div>
								<div class="text-xs">
									<span class="font-bold text-warning">{donationStatusLabel(status)}</span>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										เจ้าหน้าที่กำลังดำเนินการกับรายการนี้
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
									<span class="font-bold text-danger">{donationStatusLabel(status)}</span>
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
									<span class="font-bold text-foreground">ตรวจรับของเข้าคลังเรียบร้อย</span>
									{#if donation.received_summary?.received_at}
										<p class="mt-0.5 text-[10px] text-muted-foreground">
											{formatTrackTimestamp(donation.received_summary.received_at)}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<div class="space-y-4">
						<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
							ข้อมูลผู้บริจาคและการนัดหมาย
						</h4>
						<div class="space-y-3.5 rounded-2xl border border-border bg-card p-4 text-xs">
							<div class="flex gap-2.5">
								<User class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>ผู้ประสงค์บริจาค</span
									>
									<p class="mt-0.5 font-bold text-foreground">
										{donation.donor.name ?? '—'}
									</p>
									{#if donation.donor.phone_masked}
										<p class="text-[10px] text-muted-foreground">
											โทร. {donation.donor.phone_masked}
										</p>
									{/if}
								</div>
							</div>
							<div class="flex gap-2.5">
								<Calendar class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>เวลานัดหมายจัดส่ง</span
									>
									<p class="mt-0.5 font-semibold text-foreground">
										{formatTrackSchedule(donation.logistics)}
									</p>
									{#if donation.expires_at}
										<p class="mt-0.5 text-[10px] text-muted-foreground">
											หมดอายุการจอง {formatTrackTimestamp(donation.expires_at)}
										</p>
									{/if}
								</div>
							</div>
							<div class="flex gap-2.5">
								<MapPin class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>ศูนย์ปลายทาง</span
									>
									<p class="mt-0.5 font-semibold text-foreground">{donation.shelter_code}</p>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										{deliveryMethodLabel(donation.logistics?.delivery_method)}
										{#if donation.logistics?.vehicle}
											· {vehicleLabel(donation.logistics.vehicle)}
										{/if}
									</p>
									{#if donation.logistics?.pickup_address}
										<p class="mt-1 text-[10px] text-muted-foreground">
											จุดรับ: {donation.logistics.pickup_address}
										</p>
									{/if}
								</div>
							</div>
							{#if donation.logistics?.delivery_method === 'parcel'}
								<div class="flex gap-2.5">
									<Truck class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
									<div class="min-w-0 flex-1">
										<span class="text-[10px] font-bold text-muted-foreground uppercase"
											>เลขพัสดุขนส่ง</span
										>
										{#if showCourierEdit}
											<div class="mt-1.5 flex flex-col gap-2 sm:flex-row">
												<Input
													bind:value={courierInput}
													placeholder={donation.logistics?.courier_tracking_no || 'กรอกเลขพัสดุ'}
													class="h-9 rounded-xl text-xs"
												/>
												<Button
													onclick={saveCourier}
													disabled={courierMutation.isPending}
													class="h-9 shrink-0 rounded-xl px-3 text-xs font-bold"
												>
													{courierMutation.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
												</Button>
											</div>
										{:else}
											<p class="mt-0.5 font-semibold text-foreground">
												{donation.logistics.courier_tracking_no || '—'}
											</p>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>

					<div class="space-y-4">
						<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
							รายการสิ่งของที่บริจาค
						</h4>
						<div class="overflow-hidden rounded-2xl border border-border bg-card text-xs">
							{#if donation.items.length === 0}
								<div class="flex items-center gap-2 p-4 text-muted-foreground">
									<Package class="h-4 w-4" />
									ไม่มีรายการสิ่งของ
								</div>
							{:else}
								<table class="w-full border-collapse text-left">
									<thead>
										<tr
											class="border-b border-border bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase"
										>
											<th class="px-4 py-2.5">รายการ</th>
											<th class="px-4 py-2.5 text-right">จำนวน</th>
											<th class="px-4 py-2.5">หน่วย</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-border/60 font-semibold text-foreground">
										{#each donation.items as item, i (item.item_name + String(i))}
											<tr>
												<td class="px-4 py-3">{item.item_name}</td>
												<td class="px-4 py-3 text-right">
													{item.qty != null ? Number(item.qty).toLocaleString('th-TH') : '—'}
												</td>
												<td class="px-4 py-3 text-muted-foreground">{item.unit ?? '—'}</td>
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
								แก้ไขรายการที่จะบริจาค
							</Button>
							<p class="text-[11px] leading-relaxed text-muted-foreground">
								ปรับจำนวนหรือเพิ่ม-ลบรายการได้จนกว่าเจ้าหน้าที่จะเริ่มตรวจรับ
								{#if donation.revisions.length}
									· แก้ไขแล้ว {donation.revisions.length} ครั้ง
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
								ยกเลิกการจองนี้
							</Button>
							<p class="text-[11px] leading-relaxed text-muted-foreground">
								ยกเลิกแล้วจำนวนที่จองไว้จะถูกคืนให้ผู้บริจาคท่านอื่นทันที และย้อนกลับไม่ได้
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
