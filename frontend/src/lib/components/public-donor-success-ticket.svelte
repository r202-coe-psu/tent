<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Truck from '@lucide/svelte/icons/truck';
	import Clock from '@lucide/svelte/icons/clock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Package from '@lucide/svelte/icons/package';
	import Navigation from '@lucide/svelte/icons/navigation';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { getDonationStore } from '../../routes/public/donations/donation.svelte';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';

	const donationStore = getDonationStore();

	let courierTracking = $state('');
	let savingCourier = $state(false);
	let courierSaved = $state(false);
	let courierError = $state('');
	let qrCodeUrl = $state('');
	let isItemsModalOpen = $state(false);

	const isPendingReview = $derived(
		donationStore.deliveryMethod === 'shelter_pickup' ||
			donationStore.items.reduce((acc, curr) => acc + curr.amount, 0) > 500 ||
			donationStore.items.some((item) => !item.item_id)
	);

	$effect(() => {
		const token = donationStore.trackingToken;
		if (!token) return;
		QRCode.toDataURL(token, { margin: 1, width: 256 })
			.then((url) => (qrCodeUrl = url))
			.catch(() => toast.error('ไม่สามารถสร้าง QR Code ได้ กรุณาใช้รหัส Tracking Token แทน'));
	});

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
			} else {
				courierError = data.error || 'บันทึกเลขพัสดุไม่สำเร็จ';
			}
		} catch {
			courierError = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			savingCourier = false;
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

<div class="mx-auto w-full max-w-md animate-in font-['Prompt'] duration-300 fade-in">
	<!-- Ticket Top Part (Voucher Header) -->
	<div
		class="{isPendingReview
			? 'bg-[#ff9f0a]'
			: 'bg-[#137333]'} relative space-y-2 overflow-hidden rounded-t-3xl p-6 text-center text-white transition-colors"
	>
		<div
			class="relative z-10 mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-xs"
		>
			{#if isPendingReview}
				<Clock class="h-8 w-8 animate-pulse text-white" />
			{:else}
				<ShieldCheck class="h-8 w-8 text-white" />
			{/if}
		</div>
		<h3 class="relative z-10 text-2xl font-bold">
			{isPendingReview ? 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' : 'สำเร็จ! ตั๋วบริจาคของคุณ'}
		</h3>
		<p class="relative z-10 text-xs leading-relaxed font-medium text-white/80">
			{isPendingReview
				? 'เนื่องจากเป็นการเสนอสิ่งของทั่วไป หรือมีปริมาณที่มากเป็นพิเศษ ระบบได้ส่งรายการนี้ให้แอดมินประเมินความสามารถในการจัดเก็บของคลังแล้ว แอดมินจะติดต่อกลับให้เร็วที่สุดครับ'
				: 'แสดง QR Code นี้ให้ รปภ. หรือเจ้าหน้าที่ศูนย์'}
		</p>

		<!-- Decorative background circles -->
		<div
			class="absolute top-[-50px] right-[-50px] h-32 w-32 rounded-full bg-white/10 blur-xl"
		></div>
		<div
			class="absolute bottom-[-20px] left-[-20px] h-24 w-24 rounded-full bg-white/10 blur-xl"
		></div>
	</div>

	<!-- Ticket Bottom Part (Voucher Details) -->
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
				{#if isPendingReview}
					<div
						class="flex h-[180px] w-[180px] items-center justify-center rounded-xl border-2 border-amber-200/50 bg-amber-50"
					>
						<div class="flex flex-col items-center gap-2 text-center text-amber-600">
							<Clock class="h-10 w-10 animate-pulse" />
							<span class="text-sm font-bold">กำลังรอประเมินพื้นที่คลัง</span>
						</div>
					</div>
				{:else if qrCodeUrl}
					<img src={qrCodeUrl} alt="QR Code" class="mx-auto h-[180px] w-[180px]" />
				{:else}
					<div class="flex h-[180px] w-[180px] items-center justify-center rounded-xl bg-slate-50">
						<span class="text-xs text-slate-400">สร้าง QR Code ไม่สำเร็จ</span>
					</div>
				{/if}
			</div>

			<div class="mb-1 text-[10px] font-bold tracking-[0.2em] text-slate-400">REF.</div>
			<div class="font-mono text-xl font-bold text-slate-800">
				{donationStore.bookingRef || 'DN-XXXXXX'}
			</div>
			<div class="mt-2 text-[10px] font-semibold text-slate-400">TRACKING TOKEN</div>
			<div class="font-mono text-xs font-bold text-primary select-all">
				{donationStore.trackingToken || '-'}
			</div>
		</div>

		<div class="space-y-4 text-left">
			<div>
				<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
					<MapPin class="h-3.5 w-3.5" /> ศูนย์พักพิงปลายทาง
				</div>
				<div class="text-base font-bold text-slate-800">
					{donationStore.selectedShelterName || donationStore.shelterCode || 'ศูนย์ส่วนกลาง'}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
						<Clock class="h-3.5 w-3.5" /> เวลานัดหมาย
					</div>
					<div class="text-sm font-bold text-slate-800">
						{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
							{donationStore.slotDate} {donationStore.slotTime}
						{:else}
							{donationStore.eta || 'ตามเงื่อนไขส่งของ'}
						{/if}
					</div>
				</div>
				<div>
					<div class="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
						<ShieldCheck class="h-3.5 w-3.5" /> สถานะคิว
					</div>
					<div class="text-sm font-bold {isPendingReview ? 'text-amber-600' : 'text-[#137333]'}">
						{isPendingReview ? 'รอการประเมิน' : 'ยืนยันคิวแล้ว'}
					</div>
				</div>

				<div class="col-span-2 mt-1 border-t border-slate-100 pt-3">
					<div class="mb-2.5 flex items-center justify-between text-xs font-bold text-slate-500">
						<span class="flex items-center gap-1"
							>📦 รายการสิ่งของที่เลือกไว้ ({donationStore.items.length} รายการ)</span
						>
						<button
							type="button"
							onclick={() => (isItemsModalOpen = true)}
							class="flex cursor-pointer items-center gap-0.5 text-xs font-black text-[#013481] hover:underline"
						>
							ดูทั้งหมด
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
									{item.name || 'ไม่ได้ระบุ'} — {item.amount}
									{item.unit}
								</span>
							</span>
						{/each}
						{#if donationStore.items.length > 5}
							<span
								class="block pl-4 text-left text-[11px] font-black text-primary hover:underline"
							>
								+ ดูทั้งหมดอีก {donationStore.items.length - 5} รายการ
							</span>
						{/if}
					</button>
				</div>
			</div>
		</div>

		<!-- DN-6: courier tracking update for parcel method -->
		{#if donationStore.deliveryMethod === 'parcel'}
			<div
				class="mt-6 mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-['Prompt']"
			>
				<div class="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700">
					<Truck class="h-4 w-4 text-slate-500" />
					ส่งทางขนส่งพัสดุ? เพิ่ม/แก้ไขเลขติดตาม (Tracking No.)
				</div>
				<div class="flex items-center gap-2">
					<Input
						type="text"
						placeholder="เลขพัสดุ เช่น TH12345678"
						bind:value={courierTracking}
						class="flex-1 rounded-xl border-2 border-slate-200"
					/>
					<Button
						onclick={saveCourier}
						disabled={savingCourier || !courierTracking.trim()}
						class="shrink-0 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
					>
						{savingCourier ? 'กำลังบันทึก...' : 'บันทึก'}
					</Button>
				</div>
				{#if courierSaved}
					<p class="mt-2 text-[11px] font-bold text-emerald-600">บันทึกเลขพัสดุเรียบร้อยแล้ว</p>
				{/if}
				{#if courierError}
					<p class="mt-2 text-[11px] font-bold text-red-500">{courierError}</p>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => toast.success('กำลังเปิดแผนที่เพื่อนำทางไปยังศูนย์พักพิง')}
			class="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 py-4 text-[15px] font-bold text-white shadow-md transition-colors hover:bg-slate-800"
		>
			<Navigation class="h-4.5 w-4.5" /> นำทางด้วย Google Maps
		</button>

		<button
			type="button"
			onclick={() => donationStore.reset()}
			class="mt-3 w-full cursor-pointer rounded-xl py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-100"
		>
			กลับสู่หน้าหลัก
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
					<h4 class="font-['Prompt'] text-lg font-black tracking-tight">
						รายการสิ่งของบริจาคทั้งหมด
					</h4>
				</div>
				<button
					type="button"
					onclick={() => (isItemsModalOpen = false)}
					class="rounded-lg p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
				>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 space-y-4 overflow-y-auto p-6">
				<div
					class="border-b border-slate-100 pb-1 text-xs font-bold tracking-wider text-slate-400 uppercase"
				>
					รายการที่คุณเลือก ({donationStore.items.length} รายการ)
				</div>
				<div class="divide-y divide-slate-100 font-['Prompt']">
					{#each donationStore.items as item, index (item.id)}
						{@const dotClass = getDotColor(index)}
						<div class="flex items-start gap-3 py-3 text-left first:pt-0 last:pb-0">
							<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {dotClass.split(' ')[0]}"
							></span>
							<div class="flex-1 space-y-0.5">
								<div class="flex items-baseline justify-between gap-2">
									<span class="text-sm font-black text-slate-800">
										{item.name || 'ไม่ได้ระบุ'}
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
										>สภาพ: {item.condition === 'new'
											? 'ของใหม่ 100%'
											: item.condition === 'used'
												? 'ของมือสอง สภาพดี'
												: 'ไม่ได้ระบุ'}</span
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
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}
