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
		donationStore.items.some(item => !item.item_id)
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

<div class="animate-in fade-in duration-300 max-w-md mx-auto w-full font-['Prompt']">
	<!-- Ticket Top Part (Voucher Header) -->
	<div
		class="{isPendingReview ? 'bg-[#ff9f0a]' : 'bg-[#137333]'} text-white rounded-t-3xl p-6 text-center space-y-2 relative overflow-hidden transition-colors"
	>
		<div class="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2 relative z-10 backdrop-blur-xs">
			{#if isPendingReview}
				<Clock class="h-8 w-8 text-white animate-pulse" />
			{:else}
				<ShieldCheck class="h-8 w-8 text-white" />
			{/if}
		</div>
		<h3 class="text-2xl font-bold relative z-10">
			{isPendingReview ? 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' : 'สำเร็จ! ตั๋วบริจาคของคุณ'}
		</h3>
		<p class="text-white/80 font-medium text-xs leading-relaxed relative z-10">
			{isPendingReview
				? 'เนื่องจากเป็นการเสนอสิ่งของทั่วไป หรือมีปริมาณที่มากเป็นพิเศษ ระบบได้ส่งรายการนี้ให้แอดมินประเมินความสามารถในการจัดเก็บของคลังแล้ว แอดมินจะติดต่อกลับให้เร็วที่สุดครับ'
				: 'แสดง QR Code นี้ให้ รปภ. หรือเจ้าหน้าที่ศูนย์'}
		</p>

		<!-- Decorative background circles -->
		<div class="absolute top-[-50px] right-[-50px] w-32 h-32 bg-white/10 rounded-full blur-xl"></div>
		<div class="absolute left-[-20px] bottom-[-20px] w-24 h-24 bg-white/10 rounded-full blur-xl"></div>
	</div>

	<!-- Ticket Bottom Part (Voucher Details) -->
	<div class="bg-white p-6 border-x border-b border-slate-200 rounded-b-3xl shadow-xl relative text-center">
		<!-- Ticket cutouts visual design -->
		<div class="absolute -top-4 left-0 w-full flex justify-between px-4">
			<div class="w-8 h-8 rounded-full bg-[#f5f5f7] border border-transparent"></div>
			<div class="w-8 h-8 rounded-full bg-[#f5f5f7] border border-transparent"></div>
		</div>

		<div class="border-b-2 border-dashed border-slate-200 pb-6 mb-6 mt-4">
			<div class="bg-white p-4 border border-slate-200 shadow-2xs rounded-2xl mx-auto w-fit mb-4">
				{#if isPendingReview}
					<div class="w-[180px] h-[180px] flex items-center justify-center bg-amber-50 rounded-xl border-2 border-amber-200/50">
						<div class="text-amber-600 text-center flex flex-col items-center gap-2">
							<Clock class="h-10 w-10 animate-pulse" />
							<span class="font-bold text-sm">กำลังรอประเมินพื้นที่คลัง</span>
						</div>
					</div>
				{:else if qrCodeUrl}
					<img
						src={qrCodeUrl}
						alt="QR Code"
						class="mx-auto h-[180px] w-[180px]"
					/>
				{:else}
					<div class="w-[180px] h-[180px] flex items-center justify-center bg-slate-50 rounded-xl">
						<span class="text-xs text-slate-400">สร้าง QR Code ไม่สำเร็จ</span>
					</div>
				{/if}
			</div>
			
			<div class="text-[10px] font-bold text-slate-400 tracking-[0.2em] mb-1">
				REF.
			</div>
			<div class="text-xl font-bold font-mono text-slate-800">
				{donationStore.bookingRef || 'DN-XXXXXX'}
			</div>
			<div class="text-[10px] font-semibold text-slate-400 mt-2">
				TRACKING TOKEN
			</div>
			<div class="text-xs font-bold font-mono text-primary select-all">
				{donationStore.trackingToken || '-'}
			</div>
		</div>

		<div class="space-y-4 text-left">
			<div>
				<div class="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
					<MapPin class="h-3.5 w-3.5" /> ศูนย์พักพิงปลายทาง
				</div>
				<div class="font-bold text-base text-slate-800">
					{donationStore.selectedShelterName || donationStore.shelterCode || 'ศูนย์ส่วนกลาง'}
				</div>
			</div>
			
			<div class="grid grid-cols-2 gap-4">
				<div>
					<div class="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
						<Clock class="h-3.5 w-3.5" /> เวลานัดหมาย
					</div>
					<div class="font-bold text-slate-800 text-sm">
						{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
							{donationStore.slotDate} {donationStore.slotTime}
						{:else}
							{donationStore.eta || 'ตามเงื่อนไขส่งของ'}
						{/if}
					</div>
				</div>
				<div>
					<div class="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
						<ShieldCheck class="h-3.5 w-3.5" /> สถานะคิว
					</div>
					<div class="font-bold text-sm {isPendingReview ? 'text-amber-600' : 'text-[#137333]'}">
						{isPendingReview ? 'รอการประเมิน' : 'ยืนยันคิวแล้ว'}
					</div>
				</div>

				<div class="col-span-2 mt-1 pt-3 border-t border-slate-100">
					<div class="text-xs font-bold text-slate-500 mb-2.5 flex items-center justify-between">
						<span class="flex items-center gap-1">📦 รายการสิ่งของที่เลือกไว้ ({donationStore.items.length} รายการ)</span>
						<button
							type="button"
							onclick={() => isItemsModalOpen = true}
							class="text-xs text-[#013481] hover:underline font-black flex items-center gap-0.5 cursor-pointer"
						>
							ดูทั้งหมด
						</button>
					</div>
					<div 
						onclick={() => isItemsModalOpen = true}
						class="space-y-2 cursor-pointer hover:opacity-80 transition pl-1"
					>
						{#each donationStore.items.slice(0, 5) as item, index (item.id)}
							{@const dotClass = getDotColor(index)}
							<div class="flex items-center gap-2 text-xs font-bold">
								<span class="w-2 h-2 rounded-full shrink-0 {dotClass.split(' ')[0]}" />
								<span class="{dotClass.split(' ')[1]} truncate">
									{item.name || 'ไม่ได้ระบุ'} — {item.amount} {item.unit}
								</span>
							</div>
						{/each}
						{#if donationStore.items.length > 5}
							<div class="text-[11px] font-black text-primary hover:underline pl-4 text-left">
								+ ดูทั้งหมดอีก {donationStore.items.length - 5} รายการ
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- DN-6: courier tracking update for parcel method -->
		{#if donationStore.deliveryMethod === 'parcel'}
			<div class="mt-6 mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left font-['Prompt']">
				<div class="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700">
					<Truck class="h-4 w-4 text-slate-500" />
					ส่งทางขนส่งพัสดุ? เพิ่ม/แก้ไขเลขติดตาม (Tracking No.)
				</div>
				<div class="flex items-center gap-2">
					<Input
						type="text"
						placeholder="เลขพัสดุ เช่น TH12345678"
						bind:value={courierTracking}
						class="flex-1 border-2 border-slate-200 rounded-xl"
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
					<p class="mt-2 text-[11px] font-bold text-emerald-600">
						บันทึกเลขพัสดุเรียบร้อยแล้ว
					</p>
				{/if}
				{#if courierError}
					<p class="mt-2 text-[11px] font-bold text-red-500">{courierError}</p>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => toast.success('กำลังเปิดแผนที่เพื่อนำทางไปยังศูนย์พักพิง')}
			class="mt-8 bg-slate-950 text-white w-full py-4 rounded-xl font-bold text-[15px] shadow-md hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 cursor-pointer"
		>
			<Navigation class="h-4.5 w-4.5" /> นำทางด้วย Google Maps
		</button>

		<button
			type="button"
			onclick={() => donationStore.reset()}
			class="mt-3 text-slate-500 font-bold text-sm w-full py-3 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
		>
			กลับสู่หน้าหลัก
		</button>
	</div>
</div>

<!-- Items Modal Dialog -->
{#if isItemsModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
		<div class="flex flex-col max-h-[80vh] w-full max-w-md overflow-hidden rounded-3xl border border-slate-100 bg-white text-left shadow-2xl animate-in zoom-in-95 duration-200">
			<!-- Header -->
			<div class="flex items-center justify-between bg-slate-900 text-white p-5 shrink-0">
				<div class="flex items-center gap-2">
					<Package class="h-5 w-5 text-white" />
					<h4 class="text-lg font-black tracking-tight font-['Prompt']">รายการสิ่งของบริจาคทั้งหมด</h4>
				</div>
				<button
					type="button"
					onclick={() => isItemsModalOpen = false}
					class="rounded-lg p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
				>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-6 space-y-4">
				<div class="text-xs font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">
					รายการที่คุณเลือก ({donationStore.items.length} รายการ)
				</div>
				<div class="divide-y divide-slate-100 font-['Prompt']">
					{#each donationStore.items as item, index (item.id)}
						{@const dotClass = getDotColor(index)}
						<div class="py-3 flex items-start gap-3 text-left first:pt-0 last:pb-0">
							<span class="h-2.5 w-2.5 shrink-0 rounded-full mt-1.5 {dotClass.split(' ')[0]}"></span>
							<div class="space-y-0.5 flex-1">
								<div class="flex items-baseline justify-between gap-2">
									<span class="font-black text-sm text-slate-800">
										{item.name || 'ไม่ได้ระบุ'}
									</span>
									<span class="text-xs font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full">
										{item.amount} {item.unit}
									</span>
								</div>
								<div class="text-xs text-slate-500 font-bold flex flex-wrap items-center gap-x-2 gap-y-1">
									<span>สภาพ: {item.condition === 'new' ? 'ของใหม่ 100%' : item.condition === 'used' ? 'ของมือสอง สภาพดี' : 'ไม่ได้ระบุ'}</span>
									{#if item.remark}
										<span class="text-slate-300">|</span>
										<span class="text-slate-500 font-medium italic">"{item.remark}"</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Footer -->
			<div class="bg-slate-50 p-4 border-t border-slate-100 flex justify-end shrink-0">
				<button
					type="button"
					onclick={() => isItemsModalOpen = false}
					class="bg-slate-900 text-white hover:bg-slate-800 font-bold px-6 py-2.5 rounded-xl text-sm transition cursor-pointer"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}
