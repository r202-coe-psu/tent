<script lang="ts">
	import { onMount } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Search from '@lucide/svelte/icons/search';
	import Check from '@lucide/svelte/icons/check';
	import { env } from '$env/dynamic/public';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '$lib/components/ui/select';
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import { donationStore } from '../../../routes/public/donations/donation.svelte';

	interface Need {
		item_id: string;
		name: string;
		qty_needed: number;
		unit: string;
	}

	interface ShelterNeeds {
		code: string;
		name: string;
		needs: Need[];
	}

	let shelters = $state<ShelterNeeds[]>([]);
	let selectedDate = $state<DateValue>(today(getLocalTimeZone()));
	let selectedTime = $state('12:00');

	onMount(async () => {
		try {
			const res = await fetch('/api/public/v1/needs');
			if (res.ok) {
				shelters = await res.json();
				if (!donationStore.selectedShelter && shelters.length > 0) {
					donationStore.selectedShelter = shelters[0].code;
				}
			}
		} catch (err) {
			console.error('Failed to fetch shelters:', err);
		}
	});

	// คำนวณยอดบริจาครวมในตะกร้าและคำแนะนำเปลี่ยนเส้นทางอัจฉริยะ (T-23)
	let totalQty = $derived(donationStore.items.reduce((acc, curr) => acc + curr.amount, 0));

	let suggestion = $derived.by(() => {
		if (!donationStore.selectedShelter || shelters.length < 2) return null;

		const currentShelter = shelters.find((s) => s.code === donationStore.selectedShelter);
		if (!currentShelter) return null;

		let shouldSuggest = totalQty > 20;

		for (const donItem of donationStore.items) {
			const itemId =
				donItem.item_id ||
				(donItem.name.includes('ข้าว')
					? 'item:rice'
					: donItem.name.includes('น้ำ')
						? 'item:water'
						: donItem.name.includes('สบู่')
							? 'item:soap'
							: 'item:blanket');
			const need = currentShelter.needs.find((n) => n.item_id === itemId);
			if (!need || need.qty_needed <= 0) {
				shouldSuggest = true;
				break;
			}
		}

		if (!shouldSuggest) return null;

		let bestAltShelter: ShelterNeeds | null = null;
		let maxNeed = -1;

		for (const alt of shelters) {
			if (alt.code === donationStore.selectedShelter) continue;
			let altTotalNeed = 0;
			for (const donItem of donationStore.items) {
				const itemId =
					donItem.item_id ||
					(donItem.name.includes('ข้าว')
						? 'item:rice'
						: donItem.name.includes('น้ำ')
							? 'item:water'
							: donItem.name.includes('สบู่')
								? 'item:soap'
								: 'item:blanket');
				const need = alt.needs.find((n) => n.item_id === itemId);
				if (need) {
					altTotalNeed += need.qty_needed;
				}
			}
			if (altTotalNeed > maxNeed) {
				maxNeed = altTotalNeed;
				bestAltShelter = alt;
			}
		}

		if (bestAltShelter && maxNeed > 0) {
			return {
				code: bestAltShelter.code,
				name: bestAltShelter.name
			};
		}
		return null;
	});

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
		donationStore.captchaToken = (window as any).__captchaToken || '';

		if (!donationStore.captchaToken) {
			donationStore.errorMessage = 'กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ';
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		const dateTimeString = selectedDate ? `${selectedDate.toString()}T${selectedTime}:00.000Z` : new Date().toISOString();

		try {
			const res = await fetch('/public/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: donationStore.selectedShelter,
					donor: {
						name: donationStore.donorName || 'ไม่ระบุชื่อ',
						phone: donationStore.donorPhone || '0000000000'
					},
					items_declared: donationStore.items.length > 0 
						? donationStore.items.map(it => ({ item_name: it.name || 'ไม่ได้ระบุ', qty: it.amount || 1, unit: it.unit || 'ชิ้น' })) 
						: [{ item_name: 'ของบริจาคทั่วไป', qty: 1, unit: 'ชิ้น' }],
					captchaToken: donationStore.captchaToken
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = data.error || 'ไม่สามารถจองคิวบริจาคได้';
			} else {
				donationStore.trackingToken = data.trackingToken;
				donationStore.activeTab = 'ticket';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
			}
		} catch (err) {
			donationStore.errorMessage = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			donationStore.isSubmitting = false;
		}
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center">
	<MapPin class="mx-auto h-12 w-12 text-primary/80 mb-4" />
	<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
	<p class="mt-1 text-xs text-muted-foreground">กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ</p>

	<div class="mt-6 inline-flex flex-col gap-4 text-left w-full max-w-sm">
		<!-- กล่องแนะนำโดยระบบ AI / การเปลี่ยนเส้นทางอัจฉริยะ (T-23) -->
		{#if suggestion}
			<div class="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl space-y-2 mb-2 text-left animate-in fade-in duration-200">
				<div class="flex items-center gap-2 text-amber-700 font-bold text-[15px]">
					<Search class="h-4 w-4 text-amber-600" />
					ระบบ AI แนะนำจุดบริจาคใหม่!
				</div>
				<p class="text-sm font-medium text-amber-800 leading-relaxed">
					ศูนย์ที่คุณเจาะจง <span class="underline">ของเริ่มล้นแล้วและรถติดขัด</span>ขอแนะนำให้เปลี่ยนจุดบริจาคไปยัง
					<strong class="bg-white px-1.5 py-0.5 rounded border border-amber-200/50 text-slate-800 font-bold">{suggestion.name}</strong>
					ซึ่งเดินทางสะดวกกว่า
				</p>
				<div class="flex gap-2 mt-2.5">
					<button
						type="button"
						onclick={() => { donationStore.selectedShelter = suggestion!.code; }}
						class="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg text-[13px] font-bold flex justify-center items-center gap-1 transition-colors cursor-pointer"
					>
						ตามคำแนะนำ AI <Check class="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onclick={() => { donationStore.errorMessage = ''; }}
						class="flex-1 border border-amber-500/30 text-amber-700 py-2.5 rounded-lg text-[13px] font-bold hover:bg-amber-500/5 transition-colors cursor-pointer"
					>
						ใช้จุดเดิม
					</button>
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="destination-select" class="text-xs font-bold text-foreground">
				จุดส่งมอบปลายทาง
			</Label>
			<Select type="single" bind:value={donationStore.selectedShelter} items={shelters.map(s => ({ value: s.code, label: s.name }))}>
				<SelectTrigger class="w-full">
					<SelectValue placeholder="เลือกศูนย์พักพิง" />
				</SelectTrigger>
				<SelectContent>
					{#each shelters as s}
						<SelectItem value={s.code} label={s.name} />
					{/each}
				</SelectContent>
			</Select>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label class="text-xs font-bold text-foreground">
				วันที่ต้องการส่งมอบสิ่งของ
			</Label>
			<Popover>
				<PopoverTrigger>
					<Button variant="outline" class="w-full justify-start text-left font-normal text-xs py-3.5 h-auto">
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

		<div class="mt-4 flex justify-center">
			<div use:renderRecaptcha></div>
		</div>

		{#if donationStore.errorMessage}
			<div class="mt-4 text-xs font-bold text-danger text-center bg-danger-muted/20 border border-danger/30 p-2 rounded-lg">
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
