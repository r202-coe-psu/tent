<script lang="ts">
	import { ArrowLeft, Save } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type ActionBarMode = 'draft' | 'edit';

	let {
		mode = 'draft',
		pending = false,
		disabled = false,
		saveLabel: customSaveLabel,
		testId,
		showBack = true,
		onSave,
		onBack
	}: {
		mode?: ActionBarMode;
		pending?: boolean;
		disabled?: boolean;
		saveLabel?: string;
		testId?: string;
		showBack?: boolean;
		onSave: () => void | Promise<void>;
		onBack: () => void;
	} = $props();

	const saveLabel = $derived(
		customSaveLabel ??
			(pending ? 'กำลังบันทึก...' : mode === 'edit' ? 'บันทึกการแก้ไข' : 'บันทึกและกลับสู่เมนู')
	);
</script>

<div
	class="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-end pb-[env(safe-area-inset-bottom)] sm:inset-x-5 md:right-7 md:left-auto"
	data-testid="daily-sop-action-bar"
>
	<div
		class="pointer-events-auto flex w-full items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:w-auto"
	>
		{#if mode === 'edit' && showBack}
			<Button
				variant="outline"
				class="h-10 rounded-xl border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
				onclick={onBack}
			>
				<ArrowLeft class="size-4" /> กลับสู่เมนู
			</Button>
		{/if}
		<Button
			data-testid={testId ?? (mode === 'edit' ? 'save-edited-section' : 'save-section-draft')}
			class="h-10 flex-1 rounded-xl bg-[#013365] px-4 text-sm font-bold text-white hover:bg-[#002244] sm:flex-none"
			disabled={disabled || pending}
			onclick={onSave}
		>
			<Save class="size-4" />
			{saveLabel}
		</Button>
	</div>
</div>
