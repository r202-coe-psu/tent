<script lang="ts" module>
	import type { WalkInPrefill } from '../domain/walk-in-prefill';

	/** What a pick hands to the host: the mapped form values (never the evacuee doc) + a label. */
	export type WalkInPick = {
		prefill: WalkInPrefill;
		/** Display name of the picked evacuee, for the host's own messages. */
		label: string;
	};
</script>

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
	 * Privacy: results show the national ID masked (`maskNationalId`). The evacuee doc itself never
	 * leaves this component — `onpick` receives only the mapped form values
	 * (`evacueeToWalkInPrefill`), so the full number travels only inside `prefill.national_id`.
	 *
	 * Access: the evacuee roster is not VC data, so the host mounts this only for users who pass
	 * `canAccessEvacueeRegistration` — mounting is what enables the query.
	 */
	import { onDestroy } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import {
		useSearchEvacuees,
		maskNationalId,
		formatPersonName,
		STATUS_LABELS,
		type Evacuee
	} from '$lib/features/people';

	import { evacueeToWalkInPrefill } from '../domain/walk-in-prefill';

	let { onpick, shelterLabel }: { onpick: (pick: WalkInPick) => void; shelterLabel?: string } =
		$props();

	const FIELD_LABELS: Record<keyof WalkInPrefill, string> = {
		first_name: 'ชื่อ',
		last_name: 'นามสกุล',
		nickname: 'ชื่อเล่น',
		phone: 'เบอร์โทร',
		national_id: 'เลขบัตรประชาชน'
	};

	const MIN_CHARS = 2;
	const MAX_HITS = 8;

	let term = $state('');
	let debounced = $state('');
	let picked = $state<{ name: string; filled: string[]; skippedPhone: boolean } | null>(null);
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
	const searching = $derived(debounced.length >= MIN_CHARS);
	const failed = $derived(searching && results.isError);
	const matches = $derived<Evacuee[]>(searching && !failed ? (results.data ?? []) : []);
	const hits = $derived(matches.slice(0, MAX_HITS));
	const hiddenCount = $derived(matches.length - hits.length);

	// A failed lookup must not read as "no match" (the operator would register a duplicate), so
	// besides the inline message it raises a toast whenever a search flips into the error state.
	$effect(() => {
		if (failed) toast.error('ค้นหาผู้พักพิงไม่สำเร็จ — ลองค้นหาอีกครั้ง');
	});

	function pick(evacuee: Evacuee) {
		clearTimeout(timer);
		term = '';
		debounced = '';
		const prefill = evacueeToWalkInPrefill(evacuee);
		const name = formatPersonName(evacuee);
		picked = {
			name,
			filled: (Object.keys(prefill) as (keyof WalkInPrefill)[]).map((key) => FIELD_LABELS[key]),
			// The evacuee has a phone but it is not a 10-digit mobile, so it was left out.
			skippedPhone: !!evacuee.phone?.trim() && !('phone' in prefill)
		};
		onpick({ prefill, label: name });
	}

	function clearSearch() {
		clearTimeout(timer);
		term = '';
		debounced = '';
	}
</script>

<div class="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
	<Label for="walk-in-evacuee-search" class="text-sm font-semibold">
		ค้นหาคนในศูนย์{shelterLabel ? ` ${shelterLabel}` : ''}
		<span class="font-normal text-muted-foreground">(ทางเลือก / Optional)</span>
	</Label>
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			id="walk-in-evacuee-search"
			type="text"
			enterkeyhint="search"
			autocomplete="off"
			bind:value={term}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			onkeydown={(e) => {
				// Enter inside the search box must not submit the registration form.
				if (e.key === 'Enter') e.preventDefault();
			}}
			placeholder="ชื่อ, ชื่อเล่น, เลขบัตร หรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)"
			class="h-11 rounded-xl bg-background pr-12 pl-9 text-sm shadow-xs"
		/>
		{#if term}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="absolute top-1/2 right-0 size-11 -translate-y-1/2"
				onclick={clearSearch}
			>
				<X class="size-4" />
				<span class="sr-only">ล้างคำค้น</span>
			</Button>
		{/if}
	</div>

	<div aria-live="polite" class="space-y-2">
		{#if failed}
			<p class="text-xs font-semibold text-destructive" data-testid="walk-in-evacuee-error">
				ค้นหาผู้พักพิงไม่สำเร็จ — ยังไม่ทราบว่ามีในศูนย์หรือไม่ ลองค้นหาอีกครั้งก่อนกรอกเอง
			</p>
		{:else if searching && results.isFetching && hits.length === 0}
			<p class="text-xs text-muted-foreground">กำลังค้นหา…</p>
		{:else if searching && hits.length === 0}
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
			{#if hiddenCount > 0}
				<p class="text-xs text-muted-foreground" data-testid="walk-in-evacuee-more">
					มีอีก {hiddenCount} รายการ — พิมพ์คำค้นให้ละเอียดขึ้น
				</p>
			{/if}
		{/if}

		{#if picked}
			<p class="text-xs text-emerald-700" data-testid="walk-in-evacuee-picked">
				เติมข้อมูลจาก {picked.name} แล้ว
				{#if picked.filled.length > 0}
					(แทนที่ช่อง: {picked.filled.join(', ')})
				{/if}
				— ตรวจสอบและแก้ไขได้ก่อนบันทึก
			</p>
			{#if picked.skippedPhone}
				<p class="text-xs text-amber-700" data-testid="walk-in-evacuee-phone-skipped">
					ไม่ได้เติมเบอร์โทร เพราะไม่ใช่เบอร์มือถือ 10 หลัก — กรอกเองได้
				</p>
			{/if}
		{/if}
	</div>
</div>
