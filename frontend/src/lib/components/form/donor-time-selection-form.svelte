<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Lock from '@lucide/svelte/icons/lock';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Package from '@lucide/svelte/icons/package';
	import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';
	import X from '@lucide/svelte/icons/x';
	import { env } from '$env/dynamic/public';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { publicDonationErrorMessage } from '$lib/features/donations';
	import { getDonationStore } from '../../../routes/public/donations/donation.svelte';

	const donationStore = getDonationStore();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';

	let selectedDate = $state<DateValue>(today(getLocalTimeZone()));
	let shelters = $state<Array<{ code: string; name: string }>>([]);
	let isLoading = $state(true);
	let isItemsModalOpen = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/v1/shelters');
			const data = await res.json();
			if (Array.isArray(data)) shelters = data;
		} catch {
			toast.error('ไม่สามารถโหลดรายชื่อศูนย์พักพิงได้ กรุณาลองใหม่อีกครั้ง');
		} finally {
			isLoading = false;
		}
	});

	async function submitDonation() {
		donationStore.errorMessage = '';

		if (!donationStore.deliveryMethod) {
			donationStore.errorMessage = 'กรุณาเลือกวิธีการจัดส่ง';
			return;
		}
		if (donationStore.deliveryMethod === 'self_dropoff' && !donationStore.vehicleType) {
			donationStore.errorMessage = 'กรุณาเลือกประเภทยานพาหนะ';
			return;
		}
		if (
			(donationStore.deliveryMethod === 'self_dropoff' ||
				donationStore.deliveryMethod === 'shelter_pickup') &&
			(!selectedDate || !donationStore.slotTime)
		) {
			donationStore.errorMessage = 'กรุณาเลือกวันที่และช่วงเวลา';
			return;
		}
		if (donationStore.deliveryMethod === 'shelter_pickup' && !donationStore.pickupAddress) {
			donationStore.errorMessage = 'กรุณาระบุที่อยู่สำหรับไปรับของ';
			return;
		}
		if (!donationStore.donorName.trim()) {
			donationStore.errorMessage = 'กรุณากรอกชื่อผู้บริจาค';
			return;
		}
		if (!donationStore.donorPhone.trim()) {
			donationStore.errorMessage = 'กรุณากรอกเบอร์โทรศัพท์';
			return;
		}

		donationStore.isSubmitting = true;
		let token = '';

		if (siteKey && window.grecaptcha) {
			try {
				token = await window.grecaptcha.execute(siteKey, { action: 'donate' });
			} catch {
				donationStore.errorMessage =
					'ระบบยืนยันตัวตนขัดข้อง (reCAPTCHA) กรุณาลองใหม่อีกครั้ง หรือตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
				toast.error(donationStore.errorMessage);
				donationStore.isSubmitting = false;
				return;
			}
		}

		let slotDateStr = selectedDate
			? selectedDate.toString()
			: new Date().toISOString().split('T')[0];
		let fromTime = donationStore.slotTime.split('-')[0]?.trim() || '00:00';
		let toTime = donationStore.slotTime.split('-')[1]?.trim() || '23:59';

		let logistics: Record<string, unknown> = {
			delivery_method: donationStore.deliveryMethod
		};

		if (donationStore.deliveryMethod === 'self_dropoff') {
			logistics.vehicle = donationStore.vehicleType;
			logistics.slot = { date: slotDateStr, from: fromTime, to: toTime };
		} else if (donationStore.deliveryMethod === 'shelter_pickup') {
			logistics.slot = { date: slotDateStr, from: fromTime, to: toTime };
			if (donationStore.pickupAddress) logistics.pickup_address = donationStore.pickupAddress;
			if (donationStore.eta) logistics.eta = donationStore.eta;
		} else if (donationStore.deliveryMethod === 'parcel') {
			if (donationStore.eta) logistics.eta = donationStore.eta;
			if (donationStore.courierTrackingNo)
				logistics.courier_tracking_no = donationStore.courierTrackingNo;
		}

		try {
			const res = await fetch('/api/public/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: donationStore.shelterCode,
					donor: {
						name: donationStore.donorName.trim(),
						phone: donationStore.donorPhone.trim(),
						line_id: donationStore.donorLine || undefined,
						email: donationStore.donorEmail || undefined
					},
					items:
						donationStore.items.length > 0
							? donationStore.items.map((it) => ({
									item_id: it.item_id || undefined,
									free_text: it.name || 'ไม่ได้ระบุ',
									category: it.category || undefined,
									qty: it.amount || 1,
									unit: it.unit || 'ชิ้น',
									condition: it.condition || undefined,
									note: it.remark || undefined
								}))
							: [{ free_text: 'ของบริจาคทั่วไป', qty: 1, unit: 'ชิ้น' }],
					logistics: logistics,
					captchaToken: token || 'dev-skip-token'
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = publicDonationErrorMessage(data.error);
				toast.error(donationStore.errorMessage);
			} else {
				donationStore.trackingToken = data.trackingToken;
				donationStore.bookingRef = data.bookingRef;
				donationStore.slotDate = slotDateStr;
				donationStore.activeTab = 'ticket';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
				toast.success('ยืนยันการจองคิวบริจาคสำเร็จ!');
			}
		} catch {
			donationStore.errorMessage = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
			toast.error(donationStore.errorMessage);
		} finally {
			donationStore.isSubmitting = false;
		}
	}

	const timeSlots = [
		{ label: '09:00 - 10:00', status: 'available' },
		{ label: '10:00 - 11:00', status: 'available' },
		{ label: '13:00 - 14:00', status: 'full' },
		{ label: '14:00 - 15:00', status: 'available' },
		{ label: '15:00 - 16:00', status: 'available' }
	];

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

<div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-left">
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4 mb-6">
		<div class="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
			<Navigation class="h-5 w-5" />
		</div>
		<div>
			<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์</h3>
			<p class="text-xs font-medium text-slate-400">ระบุวิธีการจัดส่งและเวลาที่จะมาถึง</p>
		</div>
	</div>

	<div class="space-y-8">
		<!-- Review Selected Items preview -->
		<div class="border-b border-slate-100 pb-5 text-left">
			<div class="text-xs font-bold text-slate-500 mb-2.5 flex items-center justify-between">
				<span class="flex items-center gap-1 text-slate-700">📦 รายการสิ่งของที่คุณเลือกบริจาค ({donationStore.items.length} รายการ)</span>
				<button
					type="button"
					onclick={() => isItemsModalOpen = true}
					class="text-xs text-primary hover:underline font-black flex items-center gap-0.5 cursor-pointer"
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
						+ ดูทั้งหมดอีก {donationStore.items.length - 5} รายการ (กดเพื่อดูทั้งหมด)
					</div>
				{/if}
			</div>
		</div>

		<!-- 1. วิธีการจัดส่ง -->
		<div>
			<label class="text-sm font-bold text-slate-800 block mb-3">
				วิธีการจัดส่ง <span class="text-red-500">*</span>
			</label>
			<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
				<button
					type="button"
					onclick={() => donationStore.deliveryMethod = 'self_dropoff'}
					class="p-4 rounded-xl border-2 text-left font-bold transition-all cursor-pointer {donationStore.deliveryMethod === 'self_dropoff' ? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]' : 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					นำมาส่งด้วยตนเอง
				</button>
				<button
					type="button"
					onclick={() => donationStore.deliveryMethod = 'parcel'}
					class="p-4 rounded-xl border-2 text-left font-bold transition-all cursor-pointer {donationStore.deliveryMethod === 'parcel' ? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]' : 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					ส่งผ่านขนส่งพัสดุ
				</button>
				<button
					type="button"
					onclick={() => donationStore.deliveryMethod = 'shelter_pickup'}
					class="p-4 rounded-xl border-2 text-left font-bold transition-all cursor-pointer {donationStore.deliveryMethod === 'shelter_pickup' ? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]' : 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					ต้องการให้รถศูนย์ไปรับ (ของเยอะมาก)
				</button>
			</div>
		</div>

		<!-- กรณีส่งไปรษณีย์ -->
		{#if donationStore.deliveryMethod === 'parcel'}
			<div class="space-y-4 animate-in fade-in duration-200">
				<h2 class="text-sm font-bold text-slate-800 block">ข้อมูลขนส่งพัสดุ</h2>
				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<Label class="mb-1.5 block text-xs font-bold text-slate-600">คาดว่าจะถึง (ETA)</Label>
						<Input bind:value={donationStore.eta} placeholder="เช่น พรุ่งนี้ช่วงบ่าย" class="h-12 border-2 border-slate-200 focus:border-[#ff9f0a] rounded-xl" />
					</div>
					<div>
						<Label class="mb-1.5 block text-xs font-bold text-slate-600">เลขพัสดุ (Tracking No.)</Label>
						<Input
							bind:value={donationStore.courierTrackingNo}
							placeholder="ระบุภายหลังได้"
							class="h-12 border-2 border-slate-200 focus:border-[#ff9f0a] rounded-xl"
						/>
					</div>
				</div>
			</div>
		{/if}

		<!-- กรณีมาส่งเอง -->
		{#if donationStore.deliveryMethod === 'self_dropoff'}
			<div class="space-y-3 animate-in fade-in duration-200">
				<label class="text-sm font-bold text-slate-800 block">
					ประเภทยานพาหนะที่จะนำมาส่ง <span class="text-red-500">*</span>
				</label>
				<p class="text-xs text-slate-500 leading-relaxed">
					ข้อมูลนี้สำคัญมาก เพื่อให้จุดรับของกะพื้นที่จอดและเตรียมคนยกของ
				</p>
				<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
					{#each ['motorcycle', 'car', 'pickup', 'truck'] as vtype (vtype)}
						<button
							type="button"
							onclick={() => donationStore.vehicleType = vtype as 'motorcycle' | 'car' | 'pickup' | 'truck'}
							class="p-3 rounded-xl border-2 text-center text-sm font-bold transition-all cursor-pointer {donationStore.vehicleType === vtype ? 'border-[#ff9f0a] bg-[#ff9f0a] text-white shadow-xs' : 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
						>
							{#if vtype === 'motorcycle'}
								รถจักรยานยนต์
							{:else if vtype === 'car'}
								รถเก๋ง / รถยนต์
							{:else if vtype === 'pickup'}
								รถกระบะ
							{:else if vtype === 'truck'}
								รถบรรทุก
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- กรณีให้รถศูนย์ไปรับ -->
		{#if donationStore.deliveryMethod === 'shelter_pickup'}
			<div class="space-y-2 animate-in fade-in duration-200">
				<label class="text-sm font-bold text-slate-800 block" for="pickup-address">
					ที่อยู่ / จุดนัดรับของ <span class="text-red-500">*</span>
				</label>
				<textarea
					id="pickup-address"
					placeholder="ระบุบ้านเลขที่ ซอย ถนน หรือจุดสังเกตเพื่อความสะดวกในการเข้ารับของ..."
					bind:value={donationStore.pickupAddress}
					class="w-full border-2 border-slate-200 focus:border-[#ff9f0a] rounded-xl p-3 bg-white font-medium text-slate-800 outline-hidden min-h-[100px] resize-none transition-all"
				></textarea>
			</div>
		{/if}

		<!-- 2. เลือกศูนย์ -->
		<div class="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-6">
			<div>
				<label class="text-sm font-bold text-slate-800 block mb-3 flex items-center gap-2">
					<MapPin class="h-4.5 w-4.5 text-slate-500" /> เลือกศูนย์รับบริจาค <span class="text-red-500">*</span>
					{#if donationStore.shelterLocked}
						<span class="ml-2 inline-flex items-center gap-1 rounded-md bg-slate-200/60 px-2 py-0.5 text-xs font-semibold text-slate-600">
							<Lock class="h-3 w-3" />
							ล็อกตามความต้องการที่เลือก
						</span>
					{/if}
				</label>

				<select
					bind:value={donationStore.shelterCode}
					disabled={donationStore.shelterLocked}
					class="w-full border-2 border-slate-200 focus:border-[#ff9f0a] rounded-xl p-4 bg-white font-bold text-slate-800 outline-hidden appearance-none shadow-2xs disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
				>
					<option value="" disabled selected>-- เลือกศูนย์พักพิงปลายทาง --</option>
					{#each shelters as shelter (shelter.code)}
						<option value={shelter.code}>{shelter.name}</option>
					{/each}
				</select>
			</div>

			<!-- 3. เลือกเวลา -->
			{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
				<div class="space-y-4 animate-in fade-in duration-200">
					<label class="text-sm font-bold text-slate-800 block flex items-center gap-2">
						<CalendarIcon class="h-4.5 w-4.5 text-slate-500" /> เลือกวันที่และช่วงเวลา {donationStore.deliveryMethod === 'shelter_pickup' ? 'ที่ต้องการให้ไปรับ' : 'ที่จะนำของมาส่ง'} <span class="text-red-500">*</span>
					</label>

					<div class="w-full">
						<Popover>
							<PopoverTrigger class="w-full">
								<Button
									variant="outline"
									class="h-auto w-full! justify-start border-2 border-slate-200 bg-white py-3.5 text-left font-bold text-slate-800 shadow-2xs hover:border-[#ff9f0a] rounded-xl"
								>
									<CalendarIcon class="mr-2 h-4.5 w-4.5 text-slate-400" />
									{#if selectedDate}
										{selectedDate.toString()}
									{:else}
										<span>เลือกวันที่</span>
									{/if}
								</Button>
							</PopoverTrigger>
							<PopoverContent class="w-auto p-0 font-['Prompt']">
								<Calendar type="single" bind:value={selectedDate} initialFocus />
							</PopoverContent>
						</Popover>
					</div>

					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
						{#each timeSlots as slot (slot.label)}
							{@const isFull = slot.status === 'full'}
							{@const isSelected = donationStore.slotTime === slot.label}
							<button
								type="button"
								disabled={isFull}
								onclick={() => {
									if (!isFull) donationStore.slotTime = slot.label;
								}}
								class="p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1
									{isFull
										? 'opacity-50 bg-slate-50 border-slate-200 cursor-not-allowed text-slate-400'
										: isSelected
											? 'bg-[#ff9f0a] border-[#ff9f0a] text-white shadow-xs'
											: 'border-slate-200 text-slate-600 hover:border-[#ff9f0a] bg-white cursor-pointer'}"
							>
								<span class="font-bold text-sm">{slot.label}</span>
								<span class="text-[10px] font-bold {isSelected ? 'text-white/80' : 'text-slate-400'}">
									{isFull ? 'คิวเต็ม (งด)' : 'ว่าง'}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>

	{#if donationStore.errorMessage}
		<div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-600">
			{donationStore.errorMessage}
		</div>
	{/if}

	<div class="pt-6 border-t border-slate-100 flex gap-4 mt-8">
		<button
			type="button"
			onclick={() => donationStore.activeTab = 'form'}
			class="bg-slate-100 text-slate-600 px-6 py-4 rounded-xl font-bold text-lg hover:bg-slate-200 transition-colors cursor-pointer"
		>
			กลับ
		</button>
		<button
			type="button"
			disabled={donationStore.isSubmitting || !donationStore.shelterCode || ((donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup') && !donationStore.slotTime) || (donationStore.deliveryMethod === 'shelter_pickup' && !donationStore.pickupAddress.trim())}
			onclick={submitDonation}
			class="flex-1 bg-[#013481] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 transition-all hover:bg-[#002244] shadow-md flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
		>
			{#if donationStore.isSubmitting}
				กำลังดำเนินการ...
			{:else}
				ยืนยันการจองคิวบริจาค <CircleCheckBig class="h-5 w-5" />
			{/if}
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
					<h4 class="text-lg font-black tracking-tight">รายการสิ่งของบริจาคทั้งหมด</h4>
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
