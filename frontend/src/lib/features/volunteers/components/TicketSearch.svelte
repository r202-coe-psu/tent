<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import QrCode from '@lucide/svelte/icons/qr-code';

	let { onSearch } = $props<{
		onSearch: (query: string) => void;
	}>();

	let searchQuery = $state('');

	function handleSearch(e: Event) {
		e.preventDefault();
		if (searchQuery.trim()) {
			onSearch(searchQuery.trim());
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
	<form onsubmit={handleSearch} class="mt-6 flex gap-3">
		<div class="relative flex-1">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="เบอร์โทรศัพท์ 10 หลัก หรือ รหัส V-XXXX"
				class="w-full rounded-xl border border-border bg-muted/20 px-4 py-3 pl-11 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-3.5 left-4 h-4.5 w-4.5 text-muted-foreground" />
		</div>
		<button
			type="submit"
			class="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
		>
			ค้นหาตั๋ว
		</button>
	</form>

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
