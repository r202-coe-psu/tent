<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import Plus from '@lucide/svelte/icons/plus';

	let {
		code = $bindable(),
		name = $bindable(),
		capacity = $bindable(),
		disabledCode = false
	}: {
		code: string;
		name: string;
		capacity: number;
		disabledCode?: boolean;
	} = $props();
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border bg-card p-6 shadow-sm">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-blue-bg text-xs font-bold text-shelter-blue-text"
			>1</span
		>
		<h2 class="text-base font-bold text-card-foreground">จัดการข้อมูลศูนย์พักพิง (Shelters)</h2>
	</div>

	<div class="space-y-4 rounded-xl border border-shelter-border bg-shelter-bg p-5">
		<h3
			class="flex items-center space-x-1 text-xs font-bold tracking-wider text-muted-foreground uppercase"
		>
			<Plus class="h-3.5 w-3.5 text-muted-foreground" /> <span>ข้อมูลศูนย์พักพิงหลัก</span>
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="shelter-code-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รหัสศูนย์ (ID) *</label
				>
				<Input
					id="shelter-code-input"
					type="text"
					bind:value={code}
					disabled={disabledCode}
					placeholder="เช่น shelter-hatyai"
				/>
			</div>
			<div>
				<label for="shelter-name-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>ชื่อศูนย์พักพิง *</label
				>
				<Input
					id="shelter-name-input"
					type="text"
					bind:value={name}
					placeholder="เช่น ศูนย์พักพิง เทศบาลนครหาดใหญ่"
				/>
			</div>
			<div>
				<label
					for="shelter-capacity-input"
					class="mb-1 block text-xs font-bold text-muted-foreground">ความจุสูงสุด (คน) *</label
				>
				<Input
					id="shelter-capacity-input"
					type="number"
					bind:value={capacity}
					placeholder="เช่น 250"
				/>
			</div>
		</div>
	</div>
</section>
