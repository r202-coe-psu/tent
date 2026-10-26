<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { useSearchEvacuees, type Evacuee } from '$lib/features/people';
	import EvacueeName from './evacuee-name.svelte';

	let {
		value = $bindable<string | null | undefined>(null),
		id,
		invalid = false
	}: { value?: string | null; id: string; invalid?: boolean } = $props();

	let term = $state('');
	let debounced = $state('');

	let timer: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput() {
		clearTimeout(timer);
		const q = term.trim();
		timer = setTimeout(() => (debounced = q), 300);
	}

	const results = useSearchEvacuees(
		() => debounced,
		() => debounced.length >= 2
	);
	const hits = $derived<Evacuee[]>(debounced.length >= 2 ? (results.data ?? []).slice(0, 8) : []);

	function pick(evacuee: Evacuee) {
		value = evacuee._id;
		clearTimeout(timer);
		term = '';
		debounced = '';
	}
</script>

{#if value}
	<div
		class="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
	>
		<EvacueeName evacueeId={value} />
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="min-h-11 min-w-11"
			onclick={() => (value = null)}
		>
			<X class="size-4" />
			<span class="sr-only">ล้างผู้เข้าพักที่เลือก</span>
		</Button>
	</div>
{:else}
	<div class="space-y-2">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				{id}
				bind:value={term}
				oninput={onSearchInput}
				aria-invalid={invalid}
				placeholder="ค้นหาชื่อ, เลขบัตร หรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)"
				class="h-11 rounded-xl bg-background pl-9 text-sm shadow-xs"
			/>
		</div>
		{#if results.isFetching && debounced.length >= 2}
			<p class="text-sm text-muted-foreground">กำลังค้นหา…</p>
		{:else if debounced.length >= 2 && hits.length === 0}
			<p class="text-sm text-muted-foreground">ไม่พบผู้เข้าพักที่ตรงกับคำค้น</p>
		{:else if hits.length > 0}
			<ul
				class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs"
			>
				{#each hits as evacuee (evacuee._id)}
					<li>
						<button
							type="button"
							class="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
							onclick={() => pick(evacuee)}
						>
							<span class="font-semibold text-foreground"
								>{evacuee.first_name} {evacuee.last_name}</span
							>
							{#if evacuee.nickname}
								<span class="ml-2 text-muted-foreground">({evacuee.nickname})</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
