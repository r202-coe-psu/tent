<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import { useDonationTrackSearch } from '$lib/features/donations';
	import { PublicPageShell } from '$lib/features/public-portal';

	let bookingRefInput = $state('');
	let phoneInput = $state('');
	const trackSearch = useDonationTrackSearch();

	async function handleSearch() {
		const bookingRef = bookingRefInput.trim().toUpperCase();
		const phone = phoneInput.trim();
		if (!bookingRef) {
			toast.error('กรุณาระบุรหัสอ้างอิง (เช่น DN-905176)');
			return;
		}
		if (!phone) {
			toast.error('กรุณาระบุเบอร์โทรศัพท์ที่ใช้ตอนจองคิว');
			return;
		}
		try {
			const result = await trackSearch.mutateAsync({ bookingRef, phone });
			goto(resolve(`/donations/track/${encodeURIComponent(result.trackingToken)}`));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ค้นหาไม่สำเร็จ');
		}
	}
</script>

<svelte:head>
	<title>ติดตามสถานะของบริจาค — Smart Shelter</title>
</svelte:head>

<PublicPageShell>
	<a
		href={resolve('/donations')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		กลับหน้าจองคิวบริจาค
	</a>

	<div
		class="overflow-hidden rounded-3xl border border-border bg-card p-6 text-foreground shadow-sm md:p-10"
	>
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"
			>
				<QrCode class="h-5 w-5" />
			</div>
			<div>
				<h1 class="text-lg font-bold tracking-tight md:text-xl">ติดตามสถานะสิ่งของบริจาค</h1>
				<p class="mt-0.5 text-xs text-muted-foreground">
					กรอกรหัสอ้างอิงบนตั๋ว (DN-…) คู่กับเบอร์โทรที่ใช้ตอนจอง
				</p>
			</div>
		</div>

		<div class="space-y-5">
			<div class="space-y-2">
				<label
					for="booking-ref-field"
					class="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
				>
					รหัสอ้างอิง (Booking Ref)
				</label>
				<Input
					id="booking-ref-field"
					type="text"
					placeholder="เช่น DN-905176"
					bind:value={bookingRefInput}
					class="h-12 w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 font-mono text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				/>
			</div>
			<div class="space-y-2">
				<label
					for="phone-field"
					class="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
				>
					เบอร์โทรศัพท์ที่ใช้ตอนจอง
				</label>
				<Input
					id="phone-field"
					type="tel"
					inputmode="tel"
					placeholder="เช่น 0812345678"
					bind:value={phoneInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') handleSearch();
					}}
					class="h-12 w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				/>
			</div>
			<Button
				onclick={handleSearch}
				disabled={trackSearch.isPending}
				class="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
			>
				<Search class="h-4 w-4" />
				{trackSearch.isPending ? 'กำลังค้นหา…' : 'ติดตามสถานะ'}
			</Button>
		</div>

		<div class="mt-8 space-y-3 border-t border-border/60 pt-6">
			<div class="flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
				<AlertCircle class="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" />
				<div>
					<span class="font-bold text-foreground">ทำไมต้องใส่เบอร์ด้วย?</span>
					<p class="mt-1">
						รหัส
						<code class="font-mono">DN-######</code>
						สั้นจำง่าย แต่เดาได้ง่าย — ระบบจึงยืนยันด้วยเบอร์โทรที่ลงทะเบียนตอนจอง เพื่อไม่ให้ผู้อื่นเปิดดูตั๋วของคุณ
					</p>
					<p class="mt-1">
						ถ้ามีลิงก์/QR จากตั๋ว (รหัส
						<code class="font-mono">TX-…</code>) สามารถเปิดตรงได้โดยไม่ต้องค้นหา
					</p>
				</div>
			</div>
		</div>
	</div>
</PublicPageShell>
