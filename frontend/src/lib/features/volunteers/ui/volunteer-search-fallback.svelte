<script lang="ts">
	/**
	 * On-Site Check-In — "ค้นหาด่วน (Search Fallback)" card. Free-text search over
	 * the already-loaded volunteer list (same "fetch once, filter client-side"
	 * convention as `people-tab.svelte`/`roster-attendance-tab.svelte`) —
	 * matches name/nickname, `volunteer_code`, phone, or `tracking_token`.
	 */
	import Search from '@lucide/svelte/icons/search';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { Volunteer } from '../domain/volunteer.schema';

	let { volunteers, onselect }: { volunteers: Volunteer[]; onselect: (v: Volunteer) => void } =
		$props();

	function fullName(v: Volunteer): string {
		return `${v.first_name} ${v.last_name}`.trim();
	}

	let searchQuery = $state('');

	const searchResults = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return [];
		return volunteers
			.filter((v) => {
				const name = `${v.first_name} ${v.last_name} ${v.nickname ?? ''}`.toLowerCase();
				return (
					name.includes(q) ||
					v.volunteer_code.toLowerCase().includes(q) ||
					(v.phone ?? '').includes(q) ||
					(v.tracking_token ?? '').toLowerCase() === q
				);
			})
			.slice(0, 8);
	});

	function select(v: Volunteer) {
		searchQuery = '';
		onselect(v);
	}
</script>

<Card.Root class="border-border">
	<Card.Content class="space-y-3">
		<div class="flex items-center gap-2">
			<Search class="size-4 text-muted-foreground" />
			<h3 class="text-sm font-bold text-foreground">ค้นหาด่วน (Search Fallback)</h3>
			<span class="ml-auto text-[11px] text-muted-foreground">กรณีแบตหมด / ไม่มีตั๋ว</span>
		</div>
		<p class="text-[11px] text-muted-foreground">
			พิมพ์ <span class="font-semibold text-foreground">เบอร์โทร</span>,
			<span class="font-semibold text-foreground">ชื่อ</span>, หรือ
			<span class="font-semibold text-foreground">Token</span>:
		</p>
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="text"
				placeholder="พิมพ์เบอร์โทร, ชื่อ, หรือ Token..."
				bind:value={searchQuery}
				class="h-11 pl-9"
			/>
		</div>
		{#if searchQuery.trim()}
			<div class="max-h-64 space-y-1.5 overflow-y-auto">
				{#if searchResults.length === 0}
					<p class="py-6 text-center text-xs font-semibold text-muted-foreground">
						ไม่พบรายชื่อที่ตรงกับคำค้นหา
					</p>
				{:else}
					{#each searchResults as v (v._id)}
						<button
							type="button"
							onclick={() => select(v)}
							class="flex w-full items-center justify-between rounded-xl border border-border p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
						>
							<div class="min-w-0">
								<p class="truncate text-xs font-bold text-foreground">{fullName(v)}</p>
								<p class="text-[11px] text-muted-foreground">
									{v.volunteer_code} • {v.phone ?? 'ไม่ระบุเบอร์'}
								</p>
							</div>
							<span
								class="h-2 w-2 shrink-0 rounded-full {v.checked_in
									? 'bg-emerald-500'
									: 'bg-slate-300'}"
							></span>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
