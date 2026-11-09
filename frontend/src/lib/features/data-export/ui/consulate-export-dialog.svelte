<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getCountryName } from '$lib/utils/country';
	import type { ExportCountry } from '../domain/consulate-export';

	let {
		open = $bindable(false),
		countries,
		isLoading = false,
		isError = false,
		isExporting = false,
		lookupsReady = true,
		lookupsError = false,
		onRetryLookups,
		onConfirm
	}: {
		open?: boolean;
		countries: readonly ExportCountry[];
		isLoading?: boolean;
		isError?: boolean;
		isExporting?: boolean;
		/** False while zone / vulnerable-group labels are still loading. */
		lookupsReady?: boolean;
		/** True when zone / vulnerable-group labels failed to load (offer a retry). */
		lookupsError?: boolean;
		onRetryLookups?: () => void;
		onConfirm: (country: string) => void;
	} = $props();

	// FR-11: exactly one country; there is deliberately no "all countries" option.
	let selected = $state<string | null>(null);

	// Drop a pick that is no longer offered (list reloaded) so Export never targets a stale country.
	const effectiveSelected = $derived(
		selected && countries.some((c) => c.country === selected) ? selected : null
	);

	// Forget the pick whenever the dialog closes (cancel, overlay, or after a successful export).
	$effect(() => {
		if (!open) selected = null;
	});

	function countryLabel(code: string): string {
		return getCountryName(code);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title>Export รายชื่อสำหรับกงสุล</Dialog.Title>
			<Dialog.Description>
				เลือกประเทศ 1 ประเทศ ไฟล์มีข้อมูลส่วนบุคคลและการ export จะถูกบันทึก audit
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-2">
			{#if isLoading}
				<p class="py-6 text-center text-sm text-muted-foreground">กำลังโหลดรายการประเทศ...</p>
			{:else if isError}
				<p role="alert" class="py-6 text-center text-sm text-destructive">
					โหลดรายการประเทศไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
				</p>
			{:else if countries.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					ไม่มีผู้ประสบภัยชาวต่างชาติที่ export ได้ในศูนย์นี้
				</p>
			{:else}
				<fieldset class="flex flex-col gap-1">
					<legend class="sr-only">เลือกประเทศ</legend>
					{#each countries as item (item.country)}
						<label
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
						>
							<input
								type="radio"
								name="consulate-country"
								class="size-4 accent-primary"
								value={item.country}
								checked={effectiveSelected === item.country}
								onchange={() => (selected = item.country)}
							/>
							<span class="min-w-0 flex-1 truncate font-medium">{countryLabel(item.country)}</span>
							<span class="shrink-0 text-muted-foreground">{item.count} คน</span>
						</label>
					{/each}
				</fieldset>
			{/if}
			{#if !lookupsReady && countries.length > 0}
				{#if lookupsError}
					<div role="alert" class="flex flex-col items-center gap-2 pt-2 text-center">
						<p class="text-xs text-destructive">
							โหลดชื่อโซนและกลุ่มเปราะบางไม่สำเร็จ จึงยัง export ไม่ได้
						</p>
						<Button type="button" variant="outline" size="sm" onclick={() => onRetryLookups?.()}>
							ลองใหม่
						</Button>
					</div>
				{:else}
					<p class="pt-2 text-center text-xs text-muted-foreground">
						กำลังโหลดชื่อโซนและกลุ่มเปราะบาง...
					</p>
				{/if}
			{/if}
		</div>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				type="button"
				disabled={!effectiveSelected || isExporting || !lookupsReady}
				onclick={() => effectiveSelected && onConfirm(effectiveSelected)}
			>
				{isExporting ? 'กำลังสร้างไฟล์...' : 'Export'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
