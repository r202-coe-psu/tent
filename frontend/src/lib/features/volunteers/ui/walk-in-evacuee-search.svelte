<script lang="ts">
	/**
	 * "ค้นหาคนในศูนย์" — optional shortcut at the top of the walk-in dialog (#1062).
	 *
	 * An evacuee who comes to volunteer is looked up in the ACTIVE shelter's own roster
	 * (`useSearchEvacuees` reads only the active shelter's CouchDB; its query key carries the
	 * shelter code) and the host dialog copies the pick into its form via `onpick`. Nothing is
	 * linked to the evacuee and nothing is persisted from here — the operator can still edit
	 * every field, or ignore this box and type everything by hand.
	 *
	 * Privacy: results show the national ID masked (`maskNationalId`); the full number only ever
	 * travels to the host through `onpick`, which puts it in the form field.
	 */
	import { onDestroy } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		useSearchEvacuees,
		maskNationalId,
		formatPersonName,
		STATUS_LABELS,
		type Evacuee
	} from '$lib/features/people';

	let { onpick, shelterLabel }: { onpick: (evacuee: Evacuee) => void; shelterLabel?: string } =
		$props();

	const MIN_CHARS = 2;
	const MAX_HITS = 8;

	let term = $state('');
	let debounced = $state('');
	let picked = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(timer));

	function onSearchInput(value: string) {
		clearTimeout(timer);
		const q = value.trim();
		timer = setTimeout(() => (debounced = q), 300);
	}

	const results = useSearchEvacuees(
		() => debounced,
		() => debounced.length >= MIN_CHARS
	);
	const hits = $derived<Evacuee[]>(
		debounced.length >= MIN_CHARS ? (results.data ?? []).slice(0, MAX_HITS) : []
	);

	function pick(evacuee: Evacuee) {
		clearTimeout(timer);
		term = '';
		debounced = '';
		picked = formatPersonName(evacuee);
		onpick(evacuee);
	}

	function clearSearch() {
		clearTimeout(timer);
		term = '';
		debounced = '';
	}
</script>

<div class="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
	<Label for="walk-in-evacuee-search" class="text-xs font-bold">
		ค้นหาคนในศูนย์{shelterLabel ? ` ${shelterLabel}` : ''}
		<span class="font-normal text-muted-foreground">(ทางเลือก / Optional)</span>
	</Label>
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			id="walk-in-evacuee-search"
			type="search"
			autocomplete="off"
			bind:value={term}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			onkeydown={(e) => {
				// Enter inside the search box must not submit the registration form.
				if (e.key === 'Enter') e.preventDefault();
			}}
			placeholder="ชื่อ, ชื่อเล่น, เลขบัตร หรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)"
			class="h-11 rounded-xl bg-background pr-10 pl-9 text-sm shadow-xs"
		/>
		{#if term}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="absolute top-1/2 right-1 size-9 -translate-y-1/2"
				onclick={clearSearch}
			>
				<X class="size-4" />
				<span class="sr-only">ล้างคำค้น</span>
			</Button>
		{/if}
	</div>

	{#if debounced.length >= MIN_CHARS && results.isFetching && hits.length === 0}
		<p class="text-xs text-muted-foreground">กำลังค้นหา…</p>
	{:else if debounced.length >= MIN_CHARS && hits.length === 0}
		<p class="text-xs text-muted-foreground">
			ไม่พบผู้พักพิงที่ตรงกับคำค้น — กรอกข้อมูลด้านล่างเองได้
		</p>
	{:else if hits.length > 0}
		<ul
			class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs"
			aria-label="ผลการค้นหาผู้พักพิง"
		>
			{#each hits as evacuee (evacuee._id)}
				<li>
					<button
						type="button"
						data-testid="walk-in-evacuee-hit"
						class="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						onclick={() => pick(evacuee)}
					>
						<span class="font-semibold text-foreground">
							{formatPersonName(evacuee)}
							{#if evacuee.nickname}
								<span class="font-normal text-muted-foreground">({evacuee.nickname})</span>
							{/if}
						</span>
						<span class="text-xs text-muted-foreground">
							บัตร {evacuee.person_id?.cardType === 'anonymous'
								? '—'
								: maskNationalId(evacuee.person_id?.number)}
							· โทร {evacuee.phone || '—'}
							· {STATUS_LABELS[evacuee.current_stay.status] ?? evacuee.current_stay.status}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if picked}
		<p class="text-xs text-emerald-700" role="status">
			เติมข้อมูลจาก {picked} แล้ว — ตรวจสอบและแก้ไขได้ก่อนบันทึก
		</p>
	{/if}
</div>
