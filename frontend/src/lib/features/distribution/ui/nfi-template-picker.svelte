<script lang="ts">
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Package from '@lucide/svelte/icons/package';
	import { Badge } from '$lib/components/ui/badge';
	import { NFI_TEMPLATE_PRESETS } from './create-request-form';

	interface Props {
		disabled?: boolean;
	}

	let { disabled = false }: Props = $props();
</script>

<div class="space-y-3 {disabled ? 'pointer-events-none opacity-50' : ''}">
	<div class="flex items-center justify-between">
		<div>
			<h4 class="text-sm font-semibold text-foreground">
				เทมเพลตมาตรฐาน NFI (ชุดสิ่งของช่วยเหลือ)
			</h4>
			<p class="text-xs text-muted-foreground">เลือกเทมเพลตเพื่อช่วยคำนวณและกรอกรายการตามมาตรฐาน</p>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
		{#each NFI_TEMPLATE_PRESETS as preset (preset.id)}
			<div
				class="relative flex flex-col justify-between rounded-lg border border-border/70 bg-muted/30 p-3.5 opacity-75 transition-colors"
			>
				<div class="space-y-1.5">
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2">
							<Package class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm font-medium text-foreground">{preset.title}</span>
						</div>
						<Badge
							variant="outline"
							class="border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
						>
							ยังไม่พร้อมใช้งาน
						</Badge>
					</div>
					<p class="text-xs text-muted-foreground">{preset.subtitle}</p>
					<p class="text-xs text-muted-foreground/80">{preset.description}</p>
				</div>

				<div
					class="mt-3 flex items-center gap-1.5 rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground"
				>
					<AlertCircle class="h-3 w-3 shrink-0 text-muted-foreground" />
					<span>{preset.unavailableReason}</span>
				</div>
			</div>
		{/each}
	</div>
</div>
