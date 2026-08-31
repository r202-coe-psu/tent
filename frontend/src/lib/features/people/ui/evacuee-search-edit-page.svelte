<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Search from '@lucide/svelte/icons/search';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import EvacueeQrSearchModal from './evacuee-qr-search-modal.svelte';

	let queryText = $state('');
	let showQrModal = $state(false);

	function submitSearch() {
		const query = queryText.trim();
		if (!query) return;
		const resultsPath = resolve('/onsite/search-edit/results');
		goto(`${resultsPath}?q=${encodeURIComponent(query)}`);
	}

	function viewEvacuee(id: string) {
		goto(resolve(`/onsite/people/evacuee-profile-view/${id}`));
	}
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8">
	<div class="mb-6 flex items-center gap-4">
		<Button
			variant="secondary"
			size="icon"
			onclick={() => goto(resolve('/onsite'))}
			class="h-10 w-10 rounded-full"
			title="กลับ"
		>
			<ArrowLeft class="size-5" />
		</Button>
		<div>
			<h1 class="flex items-center gap-2 text-xl font-bold text-foreground md:text-2xl">
				<Search class="size-5 text-primary md:size-6" />
				ค้นหาและแก้ไขข้อมูลผู้พักพิง
			</h1>
			<p class="mt-0.5 text-xs font-semibold text-muted-foreground">Search &amp; Update</p>
		</div>
	</div>

	<Card.Root class="rounded-3xl border-border shadow-sm">
		<Card.Content class="flex flex-col items-center gap-5 px-6 py-10 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-muted text-primary"
			>
				<ShieldCheck class="size-8" />
			</div>

			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-primary-muted px-3 py-1 text-xs font-bold text-primary"
			>
				ระบบค้นหาข้อมูลผู้พักพิง (PDPA Protected)
			</span>

			<div>
				<h2 class="text-2xl font-bold text-foreground">ค้นหาและแก้ไขข้อมูลผู้พักพิง</h2>
				<p class="mt-1.5 text-sm text-muted-foreground">
					กรุณาระบุเลขประจำตัวประชาชน, เบอร์โทรศัพท์ หรือสแกน QR Code ประจำตัว
				</p>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					submitSearch();
				}}
				class="w-full space-y-3"
			>
				<div class="relative">
					<Search class="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="text"
						placeholder="ระบุเลขบัตรประชาชน / เบอร์โทรศัพท์ / ชื่อ-นามสกุล..."
						bind:value={queryText}
						class="h-12 rounded-xl bg-muted/50 pl-11 text-sm focus-visible:border-primary"
					/>
				</div>

				<div class="flex flex-col gap-3 sm:flex-row">
					<Button
						type="submit"
						disabled={!queryText.trim()}
						class="h-12 flex-1 gap-2 rounded-xl font-bold"
					>
						<Search class="size-4" />
						ค้นหาข้อมูล
					</Button>
					<Button
						type="button"
						variant="outline"
						onclick={() => (showQrModal = true)}
						class="h-12 flex-1 gap-2 rounded-xl font-bold"
					>
						<ScanLine class="size-4" />
						สแกน QR Code ตั๋ว
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<div
		class="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20"
	>
		<ShieldCheck class="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
		<p class="text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
			<span class="font-bold">มาตรการคุ้มครองข้อมูลส่วนบุคคล (PDPA):</span>
			ระบบจะไม่แสดงรายชื่อผู้พักพิงทั้งหมดบนหน้าจอสาธารณะ ข้อมูลจะปรากฏเฉพาะเมื่อเจ้าหน้าที่ทำการค้นหาเจาะจงเท่านั้น
			เพื่อความปลอดภัยและความเป็นส่วนตัวสูงสุดของผู้ประสบภัย
		</p>
	</div>
</div>

<EvacueeQrSearchModal
	show={showQrModal}
	onClose={() => (showQrModal = false)}
	onFound={(evacueeId) => {
		showQrModal = false;
		viewEvacuee(evacueeId);
	}}
/>
