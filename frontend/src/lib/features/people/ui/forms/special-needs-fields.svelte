<script lang="ts" module>
	export const SPECIAL_NEEDS_COMMON_TAGS = [
		'ใช้วีลแชร์',
		'ผู้ป่วยติดเตียง',
		'ใช้ออกซิเจน',
		'หญิงตั้งครรภ์',
		'ทารก/เด็กเล็ก',
		'ผู้พิการทางการมองเห็น',
		'ผู้พิการทางการได้ยิน',
		'มีภาวะพึ่งพิงสูง'
	] as const;

	export type SpecialNeedTag = (typeof SPECIAL_NEEDS_COMMON_TAGS)[number] | string;
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		special_needs = $bindable<string[]>([]),
		disabled = false,
		label = 'ความต้องการเพิ่มเติม',
		description = 'เลือกความต้องการเพิ่มเติมเพื่อการจัดสรรที่พักและการดูแลอย่างเหมาะสม'
	}: {
		special_needs?: string[];
		disabled?: boolean;
		label?: string;
		description?: string;
	} = $props();

	let customTag = $state('');

	function toggleTag(tag: string) {
		if (disabled) return;
		if (special_needs.includes(tag)) {
			special_needs = special_needs.filter((t) => t !== tag);
		} else {
			special_needs = [...special_needs, tag];
		}
	}

	function addCustomTag() {
		const trimmed = customTag.trim();
		if (!trimmed || disabled) return;
		if (!special_needs.includes(trimmed)) {
			special_needs = [...special_needs, trimmed];
		}
		customTag = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			addCustomTag();
		}
	}

	function removeTag(tag: string) {
		if (disabled) return;
		special_needs = special_needs.filter((t) => t !== tag);
	}

	const customTagsInUse = $derived(
		special_needs.filter((tag) => !(SPECIAL_NEEDS_COMMON_TAGS as readonly string[]).includes(tag))
	);
</script>

<div class="space-y-3">
	{#if label}
		<div class="space-y-0.5">
			<Label class="text-sm font-semibold text-foreground">{label}</Label>
			{#if description}
				<p class="text-xs text-muted-foreground">{description}</p>
			{/if}
		</div>
	{/if}

	<!-- Common tags grid -->
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		{#each SPECIAL_NEEDS_COMMON_TAGS as tag (tag)}
			{@const checked = special_needs.includes(tag)}
			<button
				type="button"
				role="checkbox"
				aria-checked={checked}
				{disabled}
				onclick={() => toggleTag(tag)}
				class="flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 {checked
					? 'border-amber-400 bg-amber-50 font-semibold text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
					: 'border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
			>
				<span
					class="flex size-4 shrink-0 items-center justify-center rounded border {checked
						? 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500'
						: 'border-muted-foreground/50'}"
				>
					{#if checked}<Check class="size-3" aria-hidden="true" />{/if}
				</span>
				<span>{tag}</span>
			</button>
		{/each}
	</div>

	<!-- Custom tags already added -->
	{#if customTagsInUse.length > 0}
		<div class="space-y-1.5 pt-1">
			<div class="flex flex-wrap gap-1.5">
				{#each customTagsInUse as tag (tag)}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
					>
						<span>{tag}</span>
						{#if !disabled}
							<button
								type="button"
								onclick={() => removeTag(tag)}
								class="rounded-full p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800"
								aria-label={`ลบ ${tag}`}
							>
								<X class="size-3" />
							</button>
						{/if}
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Custom add input -->
	{#if !disabled}
		<div class="flex gap-2 pt-1">
			<Input
				bind:value={customTag}
				placeholder="ระบุความต้องการอื่นๆ (ถ้ามี)"
				onkeydown={handleKeydown}
				class="h-9 text-xs"
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={addCustomTag}
				disabled={!customTag.trim()}
				class="h-9 shrink-0 gap-1 text-xs"
			>
				<Plus class="size-3.5" />
				เพิ่ม
			</Button>
		</div>
	{/if}
</div>
