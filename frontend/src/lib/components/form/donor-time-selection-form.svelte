<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { env } from '$env/dynamic/public';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import {
		Select,
		SelectTrigger,
		SelectContent,
		SelectItem,
		SelectValue
	} from '$lib/components/ui/select';
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { getDonationStore } from '../../../routes/public/donations/donation.svelte';
	const donationStore = getDonationStore();


	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	let selectedDate = $state<DateValue>(today(getLocalTimeZone()));
	let shelters = $state<Array<{code: string, name: string}>>([]);
	let isLoading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/v1/shelters');
			const data = await res.json();
			if (Array.isArray(data)) shelters = data;
		} catch (e) {
			console.error('Failed to load shelters:', e);
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
		if ((donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup') && (!selectedDate || !donationStore.slotTime)) {
			donationStore.errorMessage = 'กรุณาเลือกวันที่และช่วงเวลา';
			return;
		}
		if (donationStore.deliveryMethod === 'shelter_pickup' && !donationStore.pickupAddress) {
			donationStore.errorMessage = 'กรุณาระบุที่อยู่สำหรับไปรับของ';
			return;
		}

		donationStore.isSubmitting = true;
		let token = '';

		if (siteKey && (window as any).grecaptcha) {
			try {
				token = await (window as any).grecaptcha.execute(siteKey, { action: 'donate' });
			} catch (e) {
				console.error('reCAPTCHA execute error:', e);
				donationStore.errorMessage = 'ระบบยืนยันตัวตนขัดข้อง (reCAPTCHA) กรุณาลองใหม่อีกครั้ง หรือตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
				toast.error(donationStore.errorMessage);
				donationStore.isSubmitting = false;
				return;
			}
		}

		let slotDateStr = selectedDate ? selectedDate.toString() : new Date().toISOString().split('T')[0];
		let fromTime = donationStore.slotTime.split('-')[0]?.trim() || '00:00';
		let toTime = donationStore.slotTime.split('-')[1]?.trim() || '23:59';

		let logistics: any = {
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
			if (donationStore.courierTrackingNo) logistics.courier_tracking_no = donationStore.courierTrackingNo;
		}

		try {
			const res = await fetch('/api/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: donationStore.shelterCode,
					donor: {
						name: donationStore.donorName || 'ไม่ระบุชื่อ',
						phone: donationStore.donorPhone || '0000000000',
						line_id: donationStore.donorLine || undefined,
						email: donationStore.donorEmail || undefined
					},
					items:
						donationStore.items.length > 0
							? donationStore.items.map((it) => ({
									free_text: it.name || 'ไม่ได้ระบุ',
									category: it.category || undefined,
									qty: it.amount || 1,
									unit: it.unit || 'ชิ้น',
									condition: it.condition || undefined,
									note: it.remark || undefined
								}))
							: [{ free_text: 'ของบริจาคทั่วไป', qty: 1, unit: 'ชิ้น' }],
					logistics: logistics,
					captchaToken: token || undefined
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = data.error || 'ไม่สามารถจองคิวบริจาคได้';
				toast.error(donationStore.errorMessage);
			} else {
				donationStore.trackingToken = data.trackingToken;
				donationStore.activeTab = 'ticket';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
				toast.success('ยืนยันการจองคิวบริจาคสำเร็จ!');
			}
		} catch (err) {
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
</script>

<div class="rounded-xl border border-border bg-card p-8 w-full shadow-sm text-left font-['Prompt']">
	
	<div class="mb-6 flex items-center gap-4 border-b border-border pb-6">
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-warning-muted text-warning">
			<svg class="h-6 w-6 transform -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
		</div>
		<div>
			<h1 class="text-xl font-semibold text-foreground">ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์</h1>
			<p class="text-sm text-muted-foreground">ระบุวิธีการจัดส่งและเวลาที่จะมาถึง</p>
		</div>
	</div>

	<div class="mb-8">
		<h2 class="mb-3 text-sm font-semibold text-foreground">วิธีการจัดส่ง <span class="text-danger">*</span></h2>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<Button 
				variant="outline"
				onclick={() => donationStore.deliveryMethod = 'self_dropoff'}
				class="h-auto rounded-lg border px-4 py-4 text-left font-medium shadow-sm transition 
					{donationStore.deliveryMethod === 'self_dropoff' ? 'border-warning bg-warning-muted text-warning hover:bg-warning-muted/80' : 'border-border text-muted-foreground hover:bg-muted/30'}">
				นำมาส่งด้วยตนเอง
			</Button>
			<Button 
				variant="outline"
				onclick={() => donationStore.deliveryMethod = 'parcel'}
				class="h-auto rounded-lg border px-4 py-4 text-left font-medium shadow-sm transition 
					{donationStore.deliveryMethod === 'parcel' ? 'border-warning bg-warning-muted text-warning hover:bg-warning-muted/80' : 'border-border text-muted-foreground hover:bg-muted/30'}">
				ส่งผ่านขนส่งพัสดุ
			</Button>
			<Button 
				variant="outline"
				onclick={() => donationStore.deliveryMethod = 'shelter_pickup'}
				class="h-auto rounded-lg border px-4 py-4 text-left font-medium shadow-sm transition 
					{donationStore.deliveryMethod === 'shelter_pickup' ? 'border-warning bg-warning-muted text-warning hover:bg-warning-muted/80' : 'border-border text-muted-foreground hover:bg-muted/30'}">
				ต้องการให้รถศูนย์ไปรับ (ของเยอะมาก)
			</Button>
		</div>
	</div>

	<div class="mb-8 rounded-xl border border-border bg-muted/20 p-6 fade-in">
		<div class="mb-6">
			<div class="mb-2 flex items-center gap-2">
				<MapPin class="h-4 w-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold text-foreground">เลือกศูนย์รับบริจาค <span class="text-danger">*</span></h2>
			</div>
			<Select type="single" bind:value={donationStore.shelterCode}>
				<SelectTrigger class="w-full bg-card font-medium text-foreground shadow-sm border-border">
					<SelectValue placeholder="เลือกศูนย์พักพิง" />
				</SelectTrigger>
				<SelectContent class="font-['Prompt']">
					{#each shelters as shelter}
						<SelectItem value={shelter.code} label={shelter.name}>{shelter.name}</SelectItem>
					{/each}
					{#if isLoading}
						<SelectItem value="loading" label="กำลังโหลดข้อมูล..." disabled>กำลังโหลดข้อมูล...</SelectItem>
					{:else if shelters.length === 0}
						<SelectItem value="empty" label="ไม่พบศูนย์ที่เปิดรับบริจาค" disabled>ไม่พบศูนย์ที่เปิดรับบริจาค</SelectItem>
					{/if}
				</SelectContent>
			</Select>
		</div>
	</div>

	{#if donationStore.deliveryMethod === 'self_dropoff'}
	<div class="mb-8 fade-in">
		<h2 class="mb-1 text-sm font-semibold text-foreground">ประเภทยานพาหนะที่จะนำมาส่ง <span class="text-destructive">*</span></h2>
		<p class="mb-3 text-xs text-muted-foreground">ข้อมูลนี้สำคัญมาก เพื่อให้จุดรับของกะพื้นที่จอดและเตรียมคนยกของ</p>
		<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
			{#each ['motorcycle', 'car', 'pickup', 'truck'] as vtype}
			<Button 
				variant="outline"
				onclick={() => donationStore.vehicleType = vtype as any}
				class="h-auto rounded-lg border py-3 text-sm font-medium transition 
					{donationStore.vehicleType === vtype ? 'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 border-transparent' : 'border-border text-muted-foreground hover:bg-muted/30'}">
				{#if vtype === 'motorcycle'} รถจักรยานยนต์
				{:else if vtype === 'car'} รถเก๋ง / รถยนต์
				{:else if vtype === 'pickup'} รถกระบะ
				{:else if vtype === 'truck'} รถบรรทุก
				{/if}
			</Button>
			{/each}
		</div>
	</div>
	{/if}

	{#if donationStore.deliveryMethod === 'parcel'}
	<div class="mb-8 fade-in">
		<h2 class="mb-3 text-sm font-semibold text-foreground">ข้อมูลขนส่งพัสดุ</h2>
		<div class="grid gap-4 md:grid-cols-2">
			<div>
				<Label class="mb-1 block text-sm font-medium">คาดว่าจะถึง (ETA)</Label>
				<Input bind:value={donationStore.eta} placeholder="เช่น พรุ่งนี้ช่วงบ่าย" class="h-11" />
			</div>
			<div>
				<Label class="mb-1 block text-sm font-medium">เลขพัสดุ (Tracking No.)</Label>
				<Input bind:value={donationStore.courierTrackingNo} placeholder="ระบุภายหลังได้" class="h-11" />
			</div>
		</div>
	</div>
	{/if}

	{#if donationStore.deliveryMethod === 'shelter_pickup'}
	<div class="mb-8 fade-in">
		<h2 class="mb-3 text-sm font-semibold text-foreground">ข้อมูลสถานที่ให้ไปรับ <span class="text-danger">*</span></h2>
		<div class="grid gap-4">
			<div>
				<Label class="mb-1 block text-sm font-medium">ที่อยู่ติดต่อ / รายละเอียดสถานที่</Label>
				<Textarea bind:value={donationStore.pickupAddress} placeholder="ระบุบ้านเลขที่ ซอย ถนน หรือจุดสังเกต" class="h-24 resize-none" />
			</div>
		</div>
	</div>
	{/if}

	{#if donationStore.deliveryMethod === 'self_dropoff' || donationStore.deliveryMethod === 'shelter_pickup'}
	<div class="mb-8 rounded-xl border border-border bg-muted/20 p-6 fade-in">
		<div>
			<div class="mb-3 flex items-center gap-2">
				<CalendarIcon class="h-4 w-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold text-foreground">เลือกวันที่และช่วงเวลา {donationStore.deliveryMethod === 'shelter_pickup' ? 'ที่ต้องการให้ไปรับ' : 'ที่จะนำของมาส่ง'} <span class="text-danger">*</span></h2>
			</div>
			
			<div class="mb-4">
				<Popover>
					<PopoverTrigger class="w-full">
						<Button
							variant="outline"
							class="h-auto w-full! justify-start border-border bg-card py-3 text-left font-medium text-foreground shadow-sm hover:border-warning"
						>
							<CalendarIcon class="mr-2 h-4 w-4 text-muted-foreground" />
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
				{#each timeSlots as slot}
				<Button 
					variant="outline"
					onclick={() => { if(slot.status === 'available') donationStore.slotTime = slot.label; }}
					disabled={slot.status === 'full'}
					class="h-auto flex flex-col items-center justify-center rounded-lg border p-3 text-center transition 
						{slot.status === 'full' ? 'border-border/50 bg-muted/50 cursor-not-allowed opacity-70' : 
						 donationStore.slotTime === slot.label ? 'border-warning bg-warning-muted text-warning hover:bg-warning-muted/80' : 'border-border bg-card hover:border-warning-subtle'}">
					<div class="text-sm font-medium {slot.status === 'full' ? 'text-muted-foreground' : (donationStore.slotTime === slot.label ? 'text-warning-subtle' : 'text-foreground')}">{slot.label}</div>
					<div class="mt-1 text-xs {donationStore.slotTime === slot.label ? 'text-warning' : 'text-muted-foreground'}">{slot.status === 'full' ? 'คิวเต็ม (งด)' : 'ว่าง'}</div>
				</Button>
				{/each}
			</div>
		</div>
	</div>
	{/if}

	{#if donationStore.errorMessage}
		<div
			class="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-center text-sm font-medium text-danger"
		>
			{donationStore.errorMessage}
		</div>
	{/if}

	<hr class="mb-6 mt-6 border-border">

	<div class="flex gap-4">
		<Button 
			variant="outline"
			onclick={() => donationStore.activeTab = 'form'}
			class="h-12 rounded-lg bg-muted px-8 font-medium text-foreground transition hover:bg-muted/80">
			กลับ
		</Button>
		<Button 
			onclick={submitDonation}
			disabled={donationStore.isSubmitting}
			class="h-12 flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-medium text-primary-foreground transition hover:bg-primary-dark disabled:opacity-70">
			{donationStore.isSubmitting ? 'กำลังดำเนินการ...' : 'ยืนยันการจองคิวบริจาค'}
			{#if !donationStore.isSubmitting}
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
			{/if}
		</Button>
	</div>

</div>

<style>
	.fade-in {
		animation: fadeIn 0.3s ease-in-out;
	}
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
