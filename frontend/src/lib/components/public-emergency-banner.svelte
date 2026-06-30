<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	export let alerts: { name: string; capacity: string; variant: string }[] = [];
</script>

<div
	class="mb-8 overflow-hidden rounded-xl border border-danger-border bg-danger-muted/30 shadow-xs sticky top-0 z-40 md:relative md:z-auto backdrop-blur-md"
>
	<div class="flex flex-col border-l-4 border-danger p-5 md:flex-row md:items-start md:gap-4">
		<!-- Alert Icon -->
		<div
			class="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-muted text-danger md:mb-0"
		>
			<ShieldAlert class="h-6 w-6" />
		</div>
		<!-- Alert Content -->
		<div class="flex-1">
			<h3 class="text-base font-bold text-danger">ประกาศด่วนระดับ 4 (อพยพทันที)</h3>
			<p class="mt-1 text-sm leading-relaxed text-danger-subtle">
				พื้นที่ อ.เมืองน้ำท่วมสูง 1.5 - 2 เมตร กระแสไฟถูกตัดขอให้ประชาชนในพื้นที่เสี่ยงเคลื่อนย้ายมายังศูนย์พักพิงที่เปิดรับด่วน
			</p>
			<!-- Shelter Badges -->
			<div class="mt-4 flex flex-wrap gap-3">
				{#each alerts as alert}
					<div
						class="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-2xs"
					>
						<span class="text-xs font-semibold text-card-foreground">{alert.name}</span>
						<span
							class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase
							{alert.variant === 'danger' ? 'bg-danger-muted text-danger' : 'bg-chart-2/15 text-chart-2'}"
						>
							{alert.capacity}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
