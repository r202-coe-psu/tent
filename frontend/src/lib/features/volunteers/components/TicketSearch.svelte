<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Camera from '@lucide/svelte/icons/camera';
	import VolunteerQrScannerModal from './VolunteerQrScannerModal.svelte';

	let { onSearch } = $props<{
		onSearch: (query: string) => void;
	}>();

	let searchQuery = $state('');
	let isScannerOpen = $state(false);

	function handleSearch(e: Event) {
		e.preventDefault();
		if (searchQuery.trim()) {
			onSearch(searchQuery.trim());
		}
	}

	function handleScan(scannedToken: string) {
		const trimmed = scannedToken.trim();
		if (trimmed) {
			searchQuery = trimmed;
			onSearch(trimmed);
		}
	}
</script>

<div class="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
	<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
		<QrCode class="h-5 w-5 text-primary" />
		ค้นหาตั๋วของฉัน (Find My Ticket Pass)
	</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		ระบุเบอร์โทรศัพท์มือถือ หรือ Token เพื่อดึงตั๋ว QR Code การสมัครงานเดิม
	</p>

	<!-- Search Bar -->
	<form onsubmit={handleSearch} class="mt-6 flex flex-col gap-3 sm:flex-row">
		<div class="relative flex-1">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="เบอร์โทรศัพท์ 10 หลัก หรือ รหัส app_XXXX"
				class="w-full rounded-xl border border-border bg-muted/20 px-4 py-3 pl-11 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-3.5 left-4 h-4.5 w-4.5 text-muted-foreground" />
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				onclick={() => (isScannerOpen = true)}
				class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/20 active:scale-95"
				title="เปิดกล้องสแกน QR Code ตั๋ว"
			>
				<Camera class="h-4 w-4" />
				<span class="hidden sm:inline">สแกน QR</span>
			</button>
			<button
				type="submit"
				class="flex-1 cursor-pointer rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark active:scale-95 sm:flex-initial"
			>
				ค้นหาตั๋ว
			</button>
		</div>
	</form>

	<!-- Scanner Modal Component -->
	<VolunteerQrScannerModal
		bind:isOpen={isScannerOpen}
		onScan={handleScan}
		title="สแกน QR Code ค้นหาตั๋วอาสาสมัคร"
	/>

	<!-- Search Placeholder Card -->
	<div class="mt-8 rounded-2xl border border-dashed border-border bg-muted/5 p-10 text-center">
		<div
			class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-muted-foreground/60 shadow-xs"
		>
			<QrCode class="h-7 w-7" />
		</div>
		<h4 class="text-sm font-bold text-foreground">ยังไม่มีการค้นหา</h4>
		<p class="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
			ตั๋วดิจิทัลจะแสดงข้อมูลกะงาน สถานะการยืนยัน และ QR Code สำหรับสแกนเข้าพื้นที่
		</p>
	</div>
</div>
