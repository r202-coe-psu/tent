<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { SOP_RATIO_KEYS, RATIO_LABELS, type SopOverride } from '../index.js';

	let {
		profile,
		shelterCode,
		hasOverride,
		disabled,
		canEditOverride,
		onCreateOverride,
		search = ''
	}: {
		profile: SopOverride | null;
		shelterCode: string;
		hasOverride: boolean;
		disabled: boolean;
		canEditOverride: boolean;
		onCreateOverride: () => void;
		search?: string;
	} = $props();

	const filteredKeys = $derived(
		search.trim()
			? SOP_RATIO_KEYS.filter((key) => {
					const label = RATIO_LABELS[key]?.label ?? key;
					return label.toLowerCase().includes(search.trim().toLowerCase());
				})
			: SOP_RATIO_KEYS
	);
</script>

{#if !hasOverride && shelterCode}
	<!-- Context is set to Override but no override exists yet -->
	<div
		class="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center"
	>
		<svg
			class="mx-auto h-12 w-12 text-muted-foreground"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4" />
			<path d="M12 8h.01" />
		</svg>
		<h2 class="mt-4 text-base font-semibold text-foreground">
			ยังไม่มีการปรับแต่งสำหรับศูนย์ {shelterCode}
		</h2>
		<p class="mt-2 text-sm text-muted-foreground">
			ขณะนี้กำลังใช้ค่ามาตรฐาน EOC อยู่
			{#if canEditOverride}
				คุณสามารถกดปุ่มด้านล่างเพื่อเริ่มสร้างอัตราส่วนของศูนย์นี้ได้
			{:else}
				สิทธิ์การเข้าใช้งานของคุณเป็นแบบอ่านอย่างเดียว ไม่สามารถสร้างค่าปรับแต่งได้
			{/if}
		</p>
		{#if canEditOverride}
			<Button
				type="button"
				onclick={onCreateOverride}
				{disabled}
				class="mt-4 bg-amber-500 font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
			>
				สร้างค่าปรับแต่งเฉพาะศูนย์
			</Button>
		{/if}
	</div>
{:else if !shelterCode}
	<div
		class="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center"
	>
		<p class="text-sm text-muted-foreground">
			กรุณาเลือกศูนย์พักพิงในแถบด้านบนเพื่อดูหรือจัดการค่าปรับแต่ง
		</p>
	</div>
{:else}
	<div class="overflow-hidden rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground">
				<tr>
					<th class="px-4 py-3 text-left font-semibold">รายการ (Item)</th>
					<th class="px-4 py-3 text-center font-semibold">ค่ากำหนด (Value)</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredKeys as key (key)}
					{@const meta = RATIO_LABELS[key]}
					{@const value = profile?.ratios[key] ?? '-'}
					<tr class="border-t hover:bg-muted/30">
						<td class="px-4 py-3">
							<div class="font-medium text-foreground">{meta?.label ?? key}</div>
							{#if meta?.description}
								<div class="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
							{/if}
						</td>
						<td class="px-4 py-3 text-center">
							<span
								class="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
							>
								{value}
								{meta?.unit ?? ''}
							</span>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="2" class="px-4 py-8 text-center text-muted-foreground">
							ไม่พบรายการที่ต้องการค้นหา
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
