<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Lock from '@lucide/svelte/icons/lock';
	import { env } from '$env/dynamic/public';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import { donationStore } from '../../../routes/public/donations/donation.svelte';

	const shelterNames: Record<string, string> = {
		SH001: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
		SH002: 'ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)'
	};

	// logistics (DN) — slot จะเพิ่มเมื่อปลด T-02
	const deliveryMethods = [
		{ value: 'self_dropoff', label: 'นำไปส่งเอง' },
		{ value: 'parcel', label: 'ส่งทางพัสดุ/ขนส่ง' },
		{ value: 'shelter_pickup', label: 'ให้ศูนย์มารับ' }
	];
	const vehicles = [
		{ value: '', label: 'ไม่ระบุยานพาหนะ' },
		{ value: 'motorcycle', label: 'มอเตอร์ไซค์' },
		{ value: 'car', label: 'รถยนต์' },
		{ value: 'pickup', label: 'รถกระบะ' },
		{ value: 'truck', label: 'รถบรรทุก' }
	];

	let selectedDate = $state<DateValue>(today(getLocalTimeZone()));
	let selectedTime = $state('12:00');
	let deliveryMethod = $state('self_dropoff');
	let vehicle = $state('');

	// bits-ui v2 ไม่โชว์ label ของ value ที่เลือกบน trigger ให้อัตโนมัติ → คำนวณ label เอง
	const shelterLabel = $derived(shelterNames[donationStore.selectedShelter] ?? 'เลือกศูนย์พักพิง');
	const deliveryLabel = $derived(
		deliveryMethods.find((m) => m.value === deliveryMethod)?.label ?? 'เลือกวิธีนำส่ง'
	);
	const vehicleLabel = $derived(
		vehicles.find((v) => v.value === vehicle)?.label ?? 'ไม่ระบุยานพาหนะ'
	);

	function renderRecaptcha(node: HTMLElement) {
		const initCaptcha = () => {
			if (window.grecaptcha && window.grecaptcha.render) {
				try {
					window.grecaptcha.render(node, {
						sitekey: env.PUBLIC_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
						callback: 'onCaptchaSuccess'
					});
				} catch (e) {
					console.error('reCAPTCHA render error:', e);
				}
			} else {
				setTimeout(initCaptcha, 100);
			}
		};
		initCaptcha();
	}

	async function submitDonation() {
		// Read token from global variable
		donationStore.captchaToken =
			(window as unknown as { __captchaToken?: string }).__captchaToken || '';

		if (!donationStore.captchaToken) {
			donationStore.errorMessage = 'กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ';
			return;
		}

		if (deliveryMethod === 'shelter_pickup' && !donationStore.pickupAddress.trim()) {
			donationStore.errorMessage = 'กรุณากรอกที่อยู่สำหรับให้ศูนย์ไปรับของบริจาค';
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		// รวมวัน+เวลาส่งมอบ และเก็บลง store เพื่อโชว์บนตั๋ว
		const dateTimeString = selectedDate
			? `${selectedDate.toString()}T${selectedTime}:00.000Z`
			: new Date().toISOString();
		donationStore.deliveryDate = dateTimeString;
		donationStore.selectedShelterName =
			shelterNames[donationStore.selectedShelter] ?? donationStore.selectedShelter;

		try {
			const res = await fetch('/public/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: donationStore.selectedShelter,
					donor: {
						name: donationStore.donorName || 'ไม่ระบุชื่อ',
						phone: donationStore.donorPhone || '0000000000',
						line_id: donationStore.donorLine || undefined,
						email: donationStore.donorEmail || undefined
					},
					items_declared:
						donationStore.items.length > 0
							? donationStore.items.map((it) => ({
									item_id: it.item_id || undefined,
									item_name: it.name || 'ไม่ได้ระบุ',
									qty: it.amount || 1,
									unit: it.unit || 'ชิ้น',
									category: it.category || undefined,
									condition: it.condition || undefined,
									note: it.note || undefined
								}))
							: [{ item_name: 'ของบริจาคทั่วไป', qty: 1, unit: 'ชิ้น' }],
					logistics: {
						delivery_method: deliveryMethod,
						vehicle: vehicle || undefined,
						eta: dateTimeString,
						pickup_address:
							deliveryMethod === 'shelter_pickup' ? donationStore.pickupAddress : undefined
					},
					captchaToken: donationStore.captchaToken
				})
			});
			const data = await res.json();
			if (!data.success) {
				if (data.error === 'NEED_FULL') {
					donationStore.errorMessage =
						'ขออภัย สิ่งของบางรายการที่ศูนย์นี้รับครบแล้ว กรุณาเลือกศูนย์อื่นหรือรายการอื่น';
				} else {
					donationStore.errorMessage = data.error || 'ไม่สามารถจองคิวบริจาคได้';
				}
			} else {
				donationStore.trackingToken = data.trackingToken;
				donationStore.bookingRef = data.booking_ref ?? '';
				donationStore.activeTab = 'ticket';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
			}
		} catch {
			donationStore.errorMessage = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			donationStore.isSubmitting = false;
		}
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 text-center shadow-xs md:p-8">
	<MapPin class="mx-auto mb-4 h-12 w-12 text-primary/80" />
	<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ
	</p>

	<div class="mt-6 inline-flex w-full max-w-sm flex-col gap-4 text-left">
		<div class="flex flex-col gap-1.5">
			<Label for="destination-select" class="text-xs font-bold text-foreground">
				จุดส่งมอบปลายทาง
			</Label>
			<Select
				type="single"
				bind:value={donationStore.selectedShelter}
				disabled={donationStore.shelterLocked}
			>
				<SelectTrigger class="w-full">
					{shelterLabel}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="SH001" label="ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)" />
					<SelectItem value="SH002" label="ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)" />
				</SelectContent>
			</Select>
			{#if donationStore.shelterLocked}
				<p class="flex items-center gap-1 text-[11px] text-muted-foreground">
					<Lock class="h-3 w-3" />
					ล็อกศูนย์ปลายทางตามรายการที่เลือกจากกระดานความต้องการ
				</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<Label for="delivery-method" class="text-xs font-bold text-foreground">วิธีนำส่ง</Label>
			<Select type="single" bind:value={deliveryMethod}>
				<SelectTrigger class="w-full">
					{deliveryLabel}
				</SelectTrigger>
				<SelectContent>
					{#each deliveryMethods as m (m.value)}
						<SelectItem value={m.value} label={m.label} />
					{/each}
				</SelectContent>
			</Select>
		</div>

		{#if deliveryMethod === 'shelter_pickup'}
			<div class="flex animate-in flex-col gap-1.5 duration-200 fade-in slide-in-from-top-2">
				<Label for="pickup-address" class="text-xs font-bold text-foreground">
					ที่อยู่สำหรับให้ศูนย์มารับสิ่งของบริจาค
				</Label>
				<Input
					id="pickup-address"
					type="text"
					placeholder="ระบุที่อยู่โดยละเอียด เช่น บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด"
					bind:value={donationStore.pickupAddress}
				/>
			</div>
		{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="vehicle-select" class="text-xs font-bold text-foreground"
				>ยานพาหนะ (ไม่บังคับ)</Label
			>
			<Select type="single" bind:value={vehicle}>
				<SelectTrigger class="w-full">
					{vehicleLabel}
				</SelectTrigger>
				<SelectContent>
					{#each vehicles.filter((v) => v.value) as v (v.value)}
						<SelectItem value={v.value} label={v.label} />
					{/each}
				</SelectContent>
			</Select>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label class="text-xs font-bold text-foreground">วันที่ต้องการส่งมอบสิ่งของ</Label>
			<Popover>
				<PopoverTrigger>
					<Button
						variant="outline"
						class="h-auto w-full justify-start py-3.5 text-left text-xs font-normal"
					>
						<CalendarIcon class="mr-2 h-4 w-4 text-muted-foreground" />
						{#if selectedDate}
							{selectedDate.toString()}
						{:else}
							<span>เลือกวันที่ส่งมอบ</span>
						{/if}
					</Button>
				</PopoverTrigger>
				<PopoverContent class="w-auto p-0">
					<Calendar type="single" bind:value={selectedDate} initialFocus />
				</PopoverContent>
			</Popover>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label for="time-input" class="text-xs font-bold text-foreground">เวลาที่จะส่งของ</Label>
			<Input id="time-input" type="time" bind:value={selectedTime} class="mt-1" />
		</div>

		<div class="mt-4 flex justify-center">
			<div use:renderRecaptcha></div>
		</div>

		{#if donationStore.errorMessage}
			<div
				class="mt-4 rounded-lg border border-danger/30 bg-danger-muted/20 p-2 text-center text-xs font-bold text-danger"
			>
				{donationStore.errorMessage}
			</div>
		{/if}

		<Button
			onclick={submitDonation}
			disabled={donationStore.isSubmitting}
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-bold text-white transition-colors"
		>
			{donationStore.isSubmitting ? 'กำลังดำเนินการ...' : 'ยืนยันการจองคิวบริจาค'}
			{#if !donationStore.isSubmitting}<span>→</span>{/if}
		</Button>
	</div>
</div>
