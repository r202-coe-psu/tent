<script lang="ts">
	import { onMount } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Search from '@lucide/svelte/icons/search';
	import Check from '@lucide/svelte/icons/check';
	import { env } from '$env/dynamic/public';
	import { donationStore } from '../donation.svelte';

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
	let isLoading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/public/v1/needs');
			if (res.ok) {
				shelters = await res.json();
				// เลือกศูนย์แรกเป็นค่าเริ่มต้นหากยังไม่ได้เลือก
				if (!donationStore.selectedShelter && shelters.length > 0) {
					donationStore.selectedShelter = shelters[0].code;
				}
			}
		} catch (err) {
			console.error('Failed to fetch shelters:', err);
		} finally {
			isLoading = false;
		}
	});

	// ตรรกะแนะนำการเปลี่ยนเส้นทางอัจฉริยะ (Smart Redirect Suggestion)
	let totalQty = $derived(donationStore.items.reduce((acc, curr) => acc + curr.amount, 0));

	let suggestion = $derived.by(() => {
		if (!donationStore.selectedShelter || shelters.length < 2) return null;

		const currentShelter = shelters.find((s) => s.code === donationStore.selectedShelter);
		if (!currentShelter) return null;

		// แสดงคำแนะนำในการเปลี่ยนเส้นทางหาก:
		// 1. จำนวนสิ่งของที่บริจาครวมค่อนข้างเยอะ (> 20 ชิ้น)
		// 2. หรือยอดความต้องการคงเหลือของไอเทมบางชิ้นในศูนย์ปัจจุบันมีค่า <= 0 หรือไม่พบความต้องการ
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

		// ค้นหาศูนย์พักพิงทางเลือกอื่นที่มีความต้องการคงเหลือ (Gap) มากที่สุดสำหรับของที่เรากำลังบริจาค
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

	async function requestOtp() {
		// อ่านค่า token จาก global variable
		donationStore.captchaToken = (window as any).__captchaToken || '';

		if (!donationStore.captchaToken) {
			donationStore.errorMessage = 'กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ';
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		try {
			const res = await fetch('/api/public/v1/donations/otp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					phone: donationStore.donorPhone,
					captchaToken: donationStore.captchaToken
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = data.error || 'ไม่สามารถส่ง OTP ได้';
			} else {
				// Proceed to OTP step
				donationStore.activeTab = 'otp';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
			}
		} catch (err) {
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
		กําหนดเวลานำส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ
	</p>

	<div class="mt-6 inline-flex w-full max-w-sm flex-col gap-3 text-left">
		<!-- กล่องแนะนำโดยระบบ AI / การเปลี่ยนเส้นทางอัจฉริยะ -->
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

		<label for="destination-select" class="block text-xs font-bold text-foreground">
			จุดส่งมอบปลายทาง
		</label>
		<select
			id="destination-select"
			bind:value={donationStore.selectedShelter}
			class="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
		>
			{#each shelters as s}
				<option value={s.code}>{s.name}</option>
			{/each}
		</select>

		<label for="datetime-input" class="mt-2 block text-xs font-bold text-foreground">
			วันที่และเวลาที่จะส่งของ
		</label>
		<input
			id="datetime-input"
			type="datetime-local"
			bind:value={donationStore.deliveryDate}
			class="mt-1 w-full rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
		/>

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

		<button
			onclick={requestOtp}
			disabled={donationStore.isSubmitting}
			class="mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
		>
			{donationStore.isSubmitting ? 'กำลังดำเนินการ...' : 'ขอรหัส OTP เพื่อยืนยัน'}
			{#if !donationStore.isSubmitting}<span>→</span>{/if}
		</button>
	</div>
</div>
