<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { env } from '$env/dynamic/public';
	import { Label } from '$lib/components/ui/label';
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
	import { donationStore } from '../../../routes/public/donations/donation.svelte';

	let selectedShelter = $state('SH001');
	let selectedDate = $state<DateValue>(today(getLocalTimeZone()));
	let selectedTime = $state('12:00');

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
		donationStore.captchaToken = (window as any).__captchaToken || '';

		if (!donationStore.captchaToken) {
			donationStore.errorMessage = 'กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ';
			toast.error(donationStore.errorMessage);
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		// Combine date and time
		const dateTimeString = selectedDate
			? `${selectedDate.toString()}T${selectedTime}:00.000Z`
			: new Date().toISOString();

		try {
			const res = await fetch('/public/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: selectedShelter,
					donor: {
						name: donationStore.donorName || 'ไม่ระบุชื่อ',
						phone: donationStore.donorPhone || '0000000000'
					},
					items_declared:
						donationStore.items.length > 0
							? donationStore.items.map((it) => ({
									item_name: it.name || 'ไม่ได้ระบุ',
									qty: it.amount || 1,
									unit: it.unit || 'ชิ้น'
								}))
							: [{ item_name: 'ของบริจาคทั่วไป', qty: 1, unit: 'ชิ้น' }],
					captchaToken: donationStore.captchaToken
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
</script>

<div class="rounded-3xl border border-border bg-card p-6 text-center shadow-xs md:p-8">
	<MapPin class="mx-auto mb-4 h-12 w-12 text-primary/80" />
	<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ
	</p>

	<div class="mt-6 inline-flex w-full max-w-sm flex-col gap-4 text-left">
		<div class="flex flex-col gap-1.5">
<Label for="time-input" class="text-xs font-bold text-foreground">
				เวลาที่จะส่งของ
			</Label>
			<Input 
				id="time-input"
				type="time" 
				bind:value={selectedTime}
				class="mt-1"
			/>
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
			<Label for="time-select" class="text-xs font-bold text-foreground">เวลาที่จะส่งของ</Label>
			<Select type="single" bind:value={selectedTime}>
				<SelectTrigger id="time-select" class="mt-1 w-full">
					<SelectValue placeholder="เลือกเวลาส่งมอบ" />
				</SelectTrigger>
				<SelectContent class="max-h-60 overflow-y-auto">
					<SelectItem value="08:00" label="08:00 - 09:00 น." />
					<SelectItem value="09:00" label="09:00 - 10:00 น." />
					<SelectItem value="10:00" label="10:00 - 11:00 น." />
					<SelectItem value="11:00" label="11:00 - 12:00 น." />
					<SelectItem value="12:00" label="12:00 - 13:00 น." />
					<SelectItem value="13:00" label="13:00 - 14:00 น." />
					<SelectItem value="14:00" label="14:00 - 15:00 น." />
					<SelectItem value="15:00" label="15:00 - 16:00 น." />
					<SelectItem value="16:00" label="16:00 - 17:00 น." />
					<SelectItem value="17:00" label="17:00 - 18:00 น." />
				</SelectContent>
			</Select>
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
