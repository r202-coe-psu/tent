<script lang="ts">
	/** On-Site Check-In — "ประวัติการเช็คอินล่าสุด (Recent Check-in Live Feed)" card. */
	import History from '@lucide/svelte/icons/history';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { Volunteer } from '../domain/volunteer.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Job } from '../domain/job.schema';

	export type FeedEvent = {
		key: string;
		volunteer: Volunteer;
		assignment: ShiftAssignment;
		kind: 'in' | 'out';
		at: string;
	};

	let {
		events,
		jobsById,
		isPending
	}: { events: FeedEvent[]; jobsById: Map<string, Job>; isPending: boolean } = $props();

	function fullName(v: Volunteer): string {
		return `${v.first_name} ${v.last_name}`.trim();
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString('th-TH', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Bangkok'
		});
	}
</script>

<Card.Root class="border-border">
	<Card.Content class="space-y-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<History class="size-4 text-muted-foreground" />
				<h3 class="text-sm font-bold text-foreground">
					ประวัติการเช็คอินล่าสุด (Recent Check-in Live Feed)
				</h3>
			</div>
			<Badge variant="outline" class="gap-1 text-[10px] text-muted-foreground">
				<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
				อัปเดต Real-Time
			</Badge>
		</div>
		{#if isPending}
			<p class="py-6 text-center text-xs text-muted-foreground">กำลังโหลด...</p>
		{:else if events.length === 0}
			<p class="py-6 text-center text-xs font-semibold text-muted-foreground">
				ยังไม่มีการเช็คอิน/เช็คเอาต์ในวันนี้
			</p>
		{:else}
			<div class="max-h-80 space-y-2 overflow-y-auto pr-1">
				{#each events as event (event.key)}
					<div class="flex items-start gap-3 rounded-xl border border-border p-2.5">
						<span
							class="mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold {event.kind ===
							'in'
								? 'bg-emerald-100 text-emerald-700'
								: 'bg-slate-100 text-slate-600'}"
						>
							{event.kind === 'in' ? 'IN' : 'OUT'}
						</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-bold text-foreground">{fullName(event.volunteer)}</p>
							<p class="truncate text-[11px] text-muted-foreground">
								{jobsById.get(event.assignment.job_id)?.title ?? event.assignment.station} • จุดสแกนหน้างาน
							</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="text-xs font-bold text-foreground">{formatTime(event.at)} น.</p>
							<p class="text-[10px] text-muted-foreground">
								{event.kind === 'in' ? 'เข้างาน' : 'ออกงาน'}
							</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
