<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { GasManagement } from '$lib/features/kitchen';
</script>

<svelte:head>
	<title>จัดการทรัพยากรแก๊ส · SmartShelter</title>
</svelte:head>

<div class="flex-1 overflow-auto">
	<!-- Header card -->
	<div class="px-6 pt-5 pb-2">
		<div class="mx-auto max-w-3xl">
			<div class="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
				<a
					href={resolve('/back-office/kitchen')}
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition-colors hover:bg-gray-50"
					aria-label="กลับ"
				>
					<ArrowLeft class="h-3.5 w-3.5 text-gray-500" />
				</a>
				<Flame class="h-5 w-5 shrink-0 text-orange-500" />
				<div>
					<h1 class="text-base font-bold text-gray-900">จัดการทรัพยากรแก๊สสำหรับโรงครัว</h1>
					<p class="text-xs text-gray-400">
						ตั้งค่าอัตราการสิ้นเปลืองเชื้อเพลิง (Burn Rate) ของเตาแต่ละประเภท
					</p>
				</div>
			</div>
		</div>
	</div>

	<GasManagement />
</div>
