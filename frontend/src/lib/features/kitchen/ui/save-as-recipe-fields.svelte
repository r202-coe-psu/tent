<script lang="ts" module>
	/** Blank `name` / null `portions` mean "use the batch's menu label / target portions". */
	export type SaveAsRecipeDraft = { enabled: boolean; name: string; portions: number | null };

	export const emptySaveAsRecipeDraft = (): SaveAsRecipeDraft => ({
		enabled: false,
		name: '',
		portions: null
	});
</script>

<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		draft = $bindable(),
		defaultPortions
	}: { draft: SaveAsRecipeDraft; defaultPortions: number } = $props();

	const portionsInvalid = $derived(draft.portions !== null && !(draft.portions > 0));
</script>

<label class="mt-2 flex cursor-pointer items-center gap-2">
	<input
		type="checkbox"
		bind:checked={draft.enabled}
		class="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
	/>
	<span class="text-xs">บันทึกเป็นสูตรใหม่</span>
</label>
{#if draft.enabled}
	<div class="mt-2 space-y-2 rounded-md border bg-muted/20 p-2">
		<div>
			<Label for="new-recipe-name" class="text-xs">ชื่อสูตร</Label>
			<Input
				id="new-recipe-name"
				bind:value={draft.name}
				placeholder="ว่างไว้เพื่อใช้ชื่อเมนูที่แสดง"
				class="mt-1 text-xs"
			/>
		</div>
		<div>
			<Label for="new-recipe-portions" class="text-xs">จำนวนจานมาตรฐาน</Label>
			<Input
				type="number"
				min="1"
				id="new-recipe-portions"
				bind:value={draft.portions}
				placeholder={`ว่างไว้เพื่อใช้ ${defaultPortions} จาน`}
				aria-invalid={portionsInvalid}
				class="mt-1 text-xs"
			/>
			{#if portionsInvalid}
				<p class="mt-1 text-2xs text-destructive">จำนวนจานมาตรฐานต้องมากกว่า 0</p>
			{:else}
				<p class="mt-1 text-2xs text-muted-foreground">
					ปริมาณวัตถุดิบจะถูกปรับสัดส่วนให้ตรงกับจำนวนจานนี้
				</p>
			{/if}
		</div>
	</div>
{/if}
