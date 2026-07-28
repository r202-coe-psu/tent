<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import type { PublicShelterDetail } from '$lib/features/public-portal';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();
</script>

<section>
	<div class="mb-4 flex items-center gap-2">
		<AlertTriangle class="h-5 w-5 text-warning" />
		<h2 class="text-lg font-bold text-foreground">การเดินทางและข้อจำกัด</h2>
	</div>

	<div class="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
		<div class="flex items-center justify-between border-b border-border/50 p-4">
			<span class="text-sm font-semibold text-muted-foreground">เส้นทางเข้าศูนย์</span>
			<span class="ml-4 text-right text-sm font-bold text-foreground"
				>{shelter.travel?.route === 'unspecified'
					? 'ไม่มีข้อมูล'
					: shelter.travel?.route || '-'}</span
			>
		</div>
		<div class="flex items-center justify-between border-b border-border/50 p-4">
			<span class="text-sm font-semibold text-muted-foreground">ระดับความสูงจากน้ำทะเล</span>
			<span class="ml-4 text-right text-sm font-bold text-foreground"
				>{shelter.travel?.altitude === 'unspecified'
					? 'ไม่มีข้อมูล'
					: (shelter.travel?.altitude || '-') + ' เมตร'}</span
			>
		</div>
		{#if shelter.travel?.flood_warning}
			<div class="bg-danger-muted/50 p-4">
				<div class="flex items-center gap-2 text-sm font-bold text-danger">
					⚠️ {shelter.travel.flood_warning}
				</div>
			</div>
		{/if}
	</div>
</section>
