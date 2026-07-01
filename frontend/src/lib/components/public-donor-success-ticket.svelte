<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Truck from '@lucide/svelte/icons/truck';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { donationStore } from '../../routes/public/donations/donation.svelte';
	import QRCode from 'qrcode';

	let courierTracking = $state('');
	let savingCourier = $state(false);
	let courierSaved = $state(false);
	let courierError = $state('');
	let qrCodeUrl = $state('');

	$effect(() => {
		if (donationStore.trackingToken) {
			QRCode.toDataURL(donationStore.trackingToken, { margin: 1, width: 256 }, (err, url) => {
				if (!err) {
					qrCodeUrl = url;
				} else {
					console.error('Failed to generate QR code', err);
				}
			});
		}
	});

	// แปลงวันเวลาส่งมอบเป็นรูปแบบไทยที่อ่านง่าย
	const deliveryDisplay = $derived.by(() => {
		if (!donationStore.deliveryDate) return '-';
		const d = new Date(donationStore.deliveryDate);
		if (Number.isNaN(d.getTime())) return donationStore.deliveryDate;
		return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	});

	async function saveCourier() {
		if (!donationStore.trackingToken) return;
		savingCourier = true;
		courierError = '';
		courierSaved = false;
		try {
			const res = await fetch(`/public/v1/donations/${donationStore.trackingToken}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courier_tracking_no: courierTracking })
			});
			const data = await res.json();
			if (data.success) {
				courierSaved = true;
			} else {
				courierError = data.error || 'บันทึกเลขพัสดุไม่สำเร็จ';
			}
		} catch {
			courierError = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			savingCourier = false;
		}
	}
</script>

<div
	class="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-xs md:p-8"
>
	<div
		class="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border"
	>
		<Check class="h-8 w-8" />
	</div>

	<h2 class="text-lg font-bold text-foreground">จองสิทธิ์บริจาคสําเร็จ!</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		กรุณาแคปหน้าจอเพื่อเก็บตั๋วและรหัสการจองไว้ใช้ยืนยัน ณ จุดส่งมอบ
	</p>

	<div class="my-6 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5">
		{#if qrCodeUrl}
			<img
				src={qrCodeUrl}
				alt="QR Code"
				class="mx-auto mb-4 h-32 w-32 rounded-xl border border-border/80 bg-white p-2"
			/>
		{:else}
			<div
				class="mx-auto mb-4 flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-xl border border-border/80 bg-white p-3"
			>
				<span class="text-[10px] text-slate-400">QR Code</span>
				<span class="px-1 font-mono text-[8px] break-all text-slate-500"
					>{donationStore.trackingToken}</span
				>
			</div>
		{/if}

		{#if donationStore.bookingRef}
			<div class="text-xs font-bold text-foreground">รหัสการจอง (Booking Ref)</div>
			<div class="mt-1 font-mono text-base font-black tracking-wider text-foreground select-all">
				{donationStore.bookingRef}
			</div>
		{/if}

		<div class="mt-3 text-xs font-bold text-foreground">Tracking Token</div>
		<div class="mt-1 font-mono text-sm font-black tracking-wider text-primary select-all">
			{donationStore.trackingToken}
		</div>

		<div
			class="mt-4 space-y-2 border-t border-border/60 pt-4 text-left text-xs text-muted-foreground"
		>
			<div class="flex justify-between gap-2">
				<span>ผู้บริจาค:</span>
				<span class="text-right font-bold text-foreground"
					>{donationStore.donorName || 'ไม่ระบุชื่อ'}</span
				>
			</div>
			<div class="flex justify-between gap-2">
				<span>จุดส่งมอบ:</span>
				<span class="text-right font-bold text-foreground">
					{donationStore.selectedShelterName || donationStore.selectedShelter || '-'}
				</span>
			</div>
			<div class="flex justify-between gap-2">
				<span>เวลาส่งมอบ:</span>
				<span class="text-right font-bold text-foreground">{deliveryDisplay}</span>
			</div>
		</div>
	</div>

	<!-- DN-6: donor เติม/แก้เลขพัสดุ (กรณีส่งทางขนส่ง) ได้เองภายหลัง -->
	<div class="mb-6 rounded-2xl border border-border bg-muted/10 p-4 text-left">
		<div class="mb-2 flex items-center gap-2 text-xs font-bold text-foreground">
			<Truck class="h-4 w-4 text-muted-foreground" />
			ส่งทางขนส่งพัสดุ? เพิ่มเลขติดตาม (ไม่บังคับ)
		</div>
		<div class="flex items-center gap-2">
			<Input
				type="text"
				placeholder="เลขพัสดุ เช่น TH12345678"
				bind:value={courierTracking}
				class="flex-1"
			/>
			<Button
				onclick={saveCourier}
				disabled={savingCourier || !courierTracking.trim()}
				class="shrink-0"
			>
				{savingCourier ? 'กำลังบันทึก...' : 'บันทึก'}
			</Button>
		</div>
		{#if courierSaved}
			<p class="text-emerald-600 dark:text-emerald-400 mt-2 text-[11px] font-bold">บันทึกเลขพัสดุเรียบร้อยแล้ว</p>
		{/if}
		{#if courierError}
			<p class="mt-2 text-[11px] font-bold text-danger">{courierError}</p>
		{/if}
	</div>

	<button
		type="button"
		onclick={() => donationStore.reset()}
		class="w-full rounded-xl border border-border py-3 text-xs font-bold text-foreground transition-colors hover:bg-muted"
	>
		กลับหน้าแรกกระดานความต้องการ
	</button>
</div>
