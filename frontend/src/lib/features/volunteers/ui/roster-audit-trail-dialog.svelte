<script lang="ts">
	/**
	 * "ประวัติการเช็คอินและการตรวจสอบ (Check-In Audit Trail)" — Roster tab
	 * (Tab 2), owner-approved mockup 2026-08-29.
	 *
	 * NOT backed by a persisted append-only log — `shift_assignment`
	 * (schema.md §2.9) only ever stores the LATEST `check_in_at`/`check_out_at`
	 * per assignment, not a history array, and this feature has no writes to
	 * `features/shared/domain/audit.ts`'s generic `audit` doc type either. This
	 * dialog reconstructs one "check-in" + one "check-out" event per assignment
	 * from those two snapshot fields, across every `shift_assignment` the
	 * shelter has (not just today's roster) — real data, but best-effort: if an
	 * assignment were ever re-checked-in, the earlier event would already be
	 * overwritten and this trail would never see it. A true append-only
	 * check-in log is a schema addition — flagged for the CR, same convention
	 * as the other schema gaps already flagged across this feature (e.g.
	 * `volunteer-card.svelte`'s "ลบ" stub, `D-VOL-TRANSFER-APPROVE`).
	 *
	 * `check_out` events carry no source distinction (no `check_out_method`
	 * column exists — see `roster-manual-checkin-dialog.svelte`'s header
	 * comment), so the self/staff toggle here only ever filters `check_in`
	 * events; check-out rows always show regardless of the toggle.
	 */
	import History from '@lucide/svelte/icons/history';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';

	type AuditEvent = {
		key: string;
		kind: 'check_in' | 'check_out';
		ts: string;
		volunteerId: string;
		volunteerName: string;
		actorLine: string;
		noteLine: string;
		isManual: boolean;
	};

	let {
		open = $bindable(false),
		assignments,
		volunteersById,
		initialVolunteerId = null
	}: {
		open?: boolean;
		assignments: readonly ShiftAssignment[];
		volunteersById: ReadonlyMap<string, Volunteer>;
		initialVolunteerId?: string | null;
	} = $props();

	function volunteerName(id: string): string {
		const v = volunteersById.get(id);
		return v ? `${v.first_name} ${v.last_name}`.trim() : id;
	}

	const events = $derived.by<AuditEvent[]>(() => {
		const rows: AuditEvent[] = [];
		for (const a of assignments) {
			const name = volunteerName(a.volunteer_id);
			if (a.check_in_at) {
				const manual = a.check_in_method === 'manual_override';
				rows.push({
					key: `${a._id}-in`,
					kind: 'check_in',
					ts: a.check_in_at,
					volunteerId: a.volunteer_id,
					volunteerName: name,
					actorLine: manual
						? `${a.check_in_by ?? 'จนท.'} (เช็คอินแทนหน้างาน)`
						: `${name} (สแกน QR ด้วยตนเอง)`,
					noteLine: manual ? (a.check_in_reason ?? '—') : 'ตรงเวลากะทำงาน',
					isManual: manual
				});
			}
			if (a.check_out_at) {
				rows.push({
					key: `${a._id}-out`,
					kind: 'check_out',
					ts: a.check_out_at,
					volunteerId: a.volunteer_id,
					volunteerName: name,
					actorLine: `${name} (สแกน QR ด้วยตนเอง)`,
					noteLine: 'ปฏิบัติงานเสร็จสิ้น / ออกจากศูนย์',
					isManual: false
				});
			}
		}
		return rows.sort((a, b) => b.ts.localeCompare(a.ts));
	});

	const volunteerOptions = $derived.by(() => {
		const ids = new Set(events.map((e) => e.volunteerId));
		return Array.from(ids).map((id) => ({ value: id, label: volunteerName(id) }));
	});

	let volunteerFilter = $state('');
	let sourceFilter = $state<'all' | 'self' | 'manual'>('all');

	// Jump straight to one volunteer's history when opened from a roster row's
	// history icon (`roster-row.svelte`) — same "preset on open" pattern as
	// `volunteer-transfer-dialog.svelte#presetVolunteerId`.
	let lastPreset = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastPreset = null;
			return;
		}
		if (!initialVolunteerId || lastPreset === initialVolunteerId) return;
		volunteerFilter = initialVolunteerId;
		lastPreset = initialVolunteerId;
	});

	const filteredEvents = $derived.by(() => {
		let list = events;
		if (volunteerFilter) list = list.filter((e) => e.volunteerId === volunteerFilter);
		if (sourceFilter === 'self') list = list.filter((e) => e.kind === 'check_out' || !e.isManual);
		else if (sourceFilter === 'manual')
			list = list.filter((e) => e.kind === 'check_in' && e.isManual);
		return list;
	});

	function formatTs(ts: string): string {
		return new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="border-b border-border px-6 py-4">
			<Dialog.Title class="flex items-center gap-2 text-base font-bold">
				<History class="h-4.5 w-4.5 text-primary" />
				ประวัติการเช็คอินและการตรวจสอบ (Check-In Audit Trail)
			</Dialog.Title>
			<p class="mt-1 text-xs text-muted-foreground">
				บันทึกย้อนหลังการลงเวลาเข้า-ออก แยกชัดเจนระหว่างจิตอาสาทำรายการเองและเจ้าหน้าที่เช็คอินแทน
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
			<Select.Root type="single" bind:value={volunteerFilter}>
				<Select.Trigger
					class="h-9 w-full min-w-0 rounded-xl px-3 sm:w-64"
					aria-label="กรองอาสาสมัคร"
				>
					<span class="truncate">
						{volunteerFilter
							? volunteerName(volunteerFilter)
							: `อาสาสมัครทุกคน (${volunteerOptions.length})`}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label={`อาสาสมัครทุกคน (${volunteerOptions.length})`} />
					{#each volunteerOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>

			<div class="ml-auto flex items-center gap-1 rounded-xl bg-muted p-1">
				<Button
					size="sm"
					variant={sourceFilter === 'all' ? 'default' : 'ghost'}
					onclick={() => (sourceFilter = 'all')}
				>
					ทั้งหมด
				</Button>
				<Button
					size="sm"
					variant={sourceFilter === 'self' ? 'default' : 'ghost'}
					class="gap-1.5"
					onclick={() => (sourceFilter = 'self')}
				>
					<Smartphone class="h-3.5 w-3.5" />
					เช็คอินเอง
				</Button>
				<Button
					size="sm"
					variant={sourceFilter === 'manual' ? 'default' : 'ghost'}
					class="gap-1.5"
					onclick={() => (sourceFilter = 'manual')}
				>
					<UserCog class="h-3.5 w-3.5" />
					จนท. บันทึกแทน
				</Button>
			</div>
		</div>

		<div class="flex-1 space-y-3 overflow-y-auto px-6 py-4">
			{#if filteredEvents.length === 0}
				<p class="py-10 text-center text-sm text-muted-foreground">
					ไม่มีประวัติการเช็คอิน/เช็คเอาต์
				</p>
			{:else}
				{#each filteredEvents as event (event.key)}
					<div class="rounded-xl border border-border p-3.5">
						<div class="flex flex-wrap items-center gap-2">
							{#if event.kind === 'check_out'}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200"
								>
									<LogOut class="h-3 w-3" />
									เช็คเอาต์ (Check-Out)
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"
								>
									<LogIn class="h-3 w-3" />
									เช็คอิน (Check-In)
								</span>
							{/if}
							<span
								class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
							>
								{#if event.kind === 'check_in' && event.isManual}
									<UserCog class="h-3 w-3" />
									จนท. เช็คอินแทน (Source)
								{:else}
									<Smartphone class="h-3 w-3" />
									จัดอาสาเช็คอินเอง (Source)
								{/if}
							</span>
							<span class="text-sm font-bold text-foreground">{event.volunteerName}</span>
							<span class="ml-auto text-[11px] text-muted-foreground">{formatTs(event.ts)}</span>
						</div>
						<div class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
							<p class="text-muted-foreground">
								ผู้ทำรายการ:
								<span class="block font-medium text-foreground">{event.actorLine}</span>
							</p>
							<p class="text-muted-foreground">
								เหตุผล / หมายเหตุ:
								<span class="block font-medium text-foreground">{event.noteLine}</span>
							</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="flex justify-end border-t border-border px-6 py-3">
			<Button variant="outline" onclick={() => (open = false)}>ปิดหน้าต่าง</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
