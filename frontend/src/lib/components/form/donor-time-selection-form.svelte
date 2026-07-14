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

<div class="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm">
	<div class="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
		<div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
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
			<div class="mb-2.5 flex items-center justify-between text-xs font-bold text-slate-500">
				<span class="flex items-center gap-1 text-slate-700"
					>📦 รายการสิ่งของที่คุณเลือกบริจาค ({donationStore.items.length} รายการ)</span
				>
				<button
					type="button"
					onclick={() => (isItemsModalOpen = true)}
					class="flex cursor-pointer items-center gap-0.5 text-xs font-black text-primary hover:underline"
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
					<span class="block pl-4 text-left text-[11px] font-black text-primary hover:underline">
						+ ดูทั้งหมดอีก {donationStore.items.length - 5} รายการ (กดเพื่อดูทั้งหมด)
					</span>
				{/if}
			</button>
		</div>

		<!-- 1. วิธีการจัดส่ง -->
		<div>
			<span class="mb-3 block text-sm font-bold text-slate-800">
				วิธีการจัดส่ง <span class="text-danger">*</span>
			</span>
			<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
				<button
					type="button"
					onclick={() => (donationStore.deliveryMethod = 'self_dropoff')}
					class="cursor-pointer rounded-xl border-2 p-4 text-left font-bold transition-all {donationStore.deliveryMethod ===
					'self_dropoff'
						? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]'
						: 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					นำมาส่งด้วยตนเอง
				</button>
				<button
					type="button"
					onclick={() => (donationStore.deliveryMethod = 'parcel')}
					class="cursor-pointer rounded-xl border-2 p-4 text-left font-bold transition-all {donationStore.deliveryMethod ===
					'parcel'
						? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]'
						: 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					ส่งผ่านขนส่งพัสดุ
				</button>
				<button
					type="button"
					onclick={() => (donationStore.deliveryMethod = 'shelter_pickup')}
					class="cursor-pointer rounded-xl border-2 p-4 text-left font-bold transition-all {donationStore.deliveryMethod ===
					'shelter_pickup'
						? 'border-[#ff9f0a] bg-[#fff8e1] text-[#ff9f0a]'
						: 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
				>
					ต้องการให้รถศูนย์ไปรับ (ของเยอะมาก)
				</button>
			</div>
		</div>

		<!-- กรณีส่งไปรษณีย์ -->
		{#if donationStore.deliveryMethod === 'parcel'}
			<div class="animate-in space-y-4 duration-200 fade-in">
				<h2 class="block text-sm font-bold text-slate-800">ข้อมูลขนส่งพัสดุ</h2>
				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<Label class="mb-1.5 block text-xs font-bold text-slate-600">คาดว่าจะถึง (ETA)</Label>
						<Input
							bind:value={donationStore.eta}
							placeholder="เช่น พรุ่งนี้ช่วงบ่าย"
							class="h-12 rounded-xl border-2 border-slate-200 focus:border-[#ff9f0a]"
						/>
					</div>
					<div>
						<Label class="mb-1.5 block text-xs font-bold text-slate-600"
							>เลขพัสดุ (Tracking No.)</Label
						>
						<Input
							bind:value={donationStore.courierTrackingNo}
							placeholder="ระบุภายหลังได้"
							class="h-12 rounded-xl border-2 border-slate-200 focus:border-[#ff9f0a]"
						/>
					</div>
				</div>
			</div>
		{/if}

		<!-- กรณีมาส่งเอง -->
		{#if donationStore.deliveryMethod === 'self_dropoff'}
			<div class="animate-in space-y-3 duration-200 fade-in">
				<span class="block text-sm font-bold text-slate-800">
					ประเภทยานพาหนะที่จะนำมาส่ง <span class="text-danger">*</span>
				</span>
				<p class="text-xs leading-relaxed text-slate-500">
					ข้อมูลนี้สำคัญมาก เพื่อให้จุดรับของกะพื้นที่จอดและเตรียมคนยกของ
				</p>
				<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
					{#each ['motorcycle', 'car', 'pickup', 'truck'] as vtype (vtype)}
						<button
							type="button"
							onclick={() =>
								(donationStore.vehicleType = vtype as 'motorcycle' | 'car' | 'pickup' | 'truck')}
							class="cursor-pointer rounded-xl border-2 p-3 text-center text-sm font-bold transition-all {donationStore.vehicleType ===
							vtype
								? 'border-[#ff9f0a] bg-[#ff9f0a] text-white shadow-xs'
								: 'border-slate-200 text-slate-600 hover:border-[#ff9f0a]/50'}"
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
			<div class="animate-in space-y-2 duration-200 fade-in">
				<label class="block text-sm font-bold text-slate-800" for="pickup-address">
					ที่อยู่ / จุดนัดรับของ <span class="text-danger">*</span>
				</label>
				<textarea
					id="pickup-address"
					placeholder="ระบุบ้านเลขที่ ซอย ถนน หรือจุดสังเกตเพื่อความสะดวกในการเข้ารับของ..."
					bind:value={donationStore.pickupAddress}
					class="min-h-[100px] w-full resize-none rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-all focus:border-[#ff9f0a]"
				></textarea>
			</div>
		{/if}

		<!-- 2. เลือกศูนย์ -->
		<div class="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
			<div>
				<label
					class="mb-3 block flex items-center gap-2 text-sm font-bold text-slate-800"
					for="shelter-select"
				>
					<MapPin class="h-4.5 w-4.5 text-slate-500" /> เลือกศูนย์รับบริจาค
					<span class="text-danger">*</span>
					{#if donationStore.shelterLocked}
						<span
							class="ml-2 inline-flex items-center gap-1 rounded-md bg-slate-200/60 px-2 py-0.5 text-xs font-semibold text-slate-600"
						>
							<Lock class="h-3 w-3" />
							ล็อกตามความต้องการที่เลือก
						</span>
					{/if}
				</label>

				<select
					id="shelter-select"
					bind:value={donationStore.shelterCode}
					disabled={donationStore.shelterLocked}
					class="w-full appearance-none rounded-xl border-2 border-slate-200 bg-white p-4 font-bold text-slate-800 shadow-2xs outline-hidden focus:border-[#ff9f0a] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
				>
					<option value="" disabled selected>-- เลือกศูนย์พักพิงปลายทาง --</option>
					{#each shelters as shelter (shelter.code)}
						<option value={shelter.code}>{shelter.name}</option>
					{/each}
				</select>
			</div>

			<!-- 3. เลือกเวลา -->
			{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
				<div class="animate-in space-y-4 duration-200 fade-in">
					<span class="block flex items-center gap-2 text-sm font-bold text-slate-800">
						<CalendarIcon class="h-4.5 w-4.5 text-slate-500" /> เลือกวันที่และช่วงเวลา {donationStore.deliveryMethod ===
						'shelter_pickup'
							? 'ที่ต้องการให้ไปรับ'
							: 'ที่จะนำของมาส่ง'} <span class="text-danger">*</span>
					</span>

					<div class="w-full">
						<Popover>
							<PopoverTrigger class="w-full">
								<Button
									variant="outline"
									class="h-auto w-full! justify-start rounded-xl border-2 border-slate-200 bg-white py-3.5 text-left font-bold text-slate-800 shadow-2xs hover:border-[#ff9f0a]"
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
								class="flex flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 transition-all
									{isFull
									? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-50'
									: isSelected
										? 'border-[#ff9f0a] bg-[#ff9f0a] text-white shadow-xs'
										: 'cursor-pointer border-slate-200 bg-white text-slate-600 hover:border-[#ff9f0a]'}"
							>
								<span class="text-sm font-bold">{slot.label}</span>
								<span
									class="text-[10px] font-bold {isSelected ? 'text-white/80' : 'text-slate-400'}"
								>
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
		<div
			class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-600"
		>
			{donationStore.errorMessage}
		</div>
	{/if}

	<div class="mt-8 flex gap-4 border-t border-slate-100 pt-6">
		<button
			type="button"
			onclick={() => (donationStore.activeTab = 'form')}
			class="cursor-pointer rounded-xl bg-slate-100 px-6 py-4 text-lg font-bold text-slate-600 transition-colors hover:bg-slate-200"
		>
			กลับ
		</button>
		<button
			type="button"
			disabled={donationStore.isSubmitting ||
				!donationStore.shelterCode ||
				((donationStore.deliveryMethod === 'self_dropoff' ||
					donationStore.deliveryMethod === 'shelter_pickup') &&
					!donationStore.slotTime) ||
				(donationStore.deliveryMethod === 'shelter_pickup' && !donationStore.pickupAddress.trim())}
			onclick={submitDonation}
			class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#013481] py-4 text-lg font-bold text-white shadow-md transition-all hover:bg-[#002244] active:scale-95 disabled:opacity-50"
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
					<h4 class="text-lg font-black tracking-tight">รายการสิ่งของบริจาคทั้งหมด</h4>
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
