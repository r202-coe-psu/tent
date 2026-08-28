<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { useRespondToDispatchMutation, useVolunteerSchedule } from '../application/queries';
	import {
		isUpcomingShift,
		responseCodeSchema,
		needsDispatchResponse,
		shiftStatusLabel,
		type ScheduleShift
	} from '../domain/volunteer';

	interface Props {
		/** The phone the volunteer signed in with. Empty = not signed in yet. */
		phone: string;
	}

	let { phone }: Props = $props();

	const query = useVolunteerSchedule(() => phone);
	const respond = useRespondToDispatchMutation(() => phone);
	const shifts = $derived(query.data ?? []);

	/**
	 * The code a manager reads out, per offered shift.
	 *
	 * Keyed by assignment so two offers on screen keep their own box — a single shared
	 * field would carry one shift's code into the other's request.
	 */
	let codes = $state<Record<string, string>>({});
	let codeErrors = $state<Record<string, string>>({});
	let answering = $state<string | null>(null);

	async function answer(shift: ScheduleShift, action: 'accepted' | 'declined') {
		const parsed = responseCodeSchema.safeParse(codes[shift.assignment_id] ?? '');
		if (!parsed.success) {
			codeErrors[shift.assignment_id] =
				parsed.error.issues[0]?.message ?? 'กรุณากรอกรหัสที่เจ้าหน้าที่แจ้ง';
			return;
		}
		codeErrors[shift.assignment_id] = '';
		answering = shift.assignment_id;
		try {
			await respond.mutateAsync({
				assignment_id: shift.assignment_id,
				code: parsed.data,
				action
			});
			toast.success(action === 'accepted' ? 'ยอมรับภารกิจแล้ว' : 'ปฏิเสธภารกิจแล้ว');
			codes[shift.assignment_id] = '';
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ตอบรับภารกิจไม่สำเร็จ';
			codeErrors[shift.assignment_id] = message;
			toast.error(message);
		} finally {
			answering = null;
		}
	}

	// Split rather than filtered so a volunteer with only past shifts still sees them
	// instead of an empty screen that reads as "you are not rostered".
	const upcoming = $derived(shifts.filter((s) => isUpcomingShift(s)));
	const past = $derived(shifts.filter((s) => !isUpcomingShift(s)));

	function timeRange(shift: ScheduleShift): string {
		if (!shift.start_ts) return '';
		const opts = { hour: '2-digit', minute: '2-digit' } as const;
		const start = new Date(shift.start_ts);
		if (Number.isNaN(start.getTime())) return '';
		const from = start.toLocaleTimeString('th-TH', opts);
		if (!shift.end_ts) return from;
		const end = new Date(shift.end_ts);
		return Number.isNaN(end.getTime()) ? from : `${from}–${end.toLocaleTimeString('th-TH', opts)}`;
	}
</script>

{#snippet shiftCard(shift: ScheduleShift)}
	<Card.Root class={needsDispatchResponse(shift) ? 'border-amber-400 dark:border-amber-700' : ''}>
		<Card.Header>
			<div class="flex items-start justify-between gap-2">
				<Card.Title class="text-base">{shift.job_title || 'งานอาสาสมัคร'}</Card.Title>
				<Badge variant={shift.status === 'checked_in' ? 'default' : 'secondary'}>
					{shiftStatusLabel(shift.status)}
				</Badge>
			</div>
			<Card.Description class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span class="flex items-center gap-1">
					<MapPin class="size-3.5" aria-hidden="true" />
					{shift.shelter_name || shift.shelter_code}
				</span>
				<span class="flex items-center gap-1">
					<CalendarDays class="size-3.5" aria-hidden="true" />
					{shift.date}
				</span>
				{#if timeRange(shift)}
					<span class="flex items-center gap-1">
						<Clock class="size-3.5" aria-hidden="true" />
						{timeRange(shift)}
					</span>
				{/if}
			</Card.Description>
		</Card.Header>

		<Card.Content class="space-y-2 text-sm">
			{#if shift.station}
				<p class="text-muted-foreground">จุดปฏิบัติงาน: {shift.station}</p>
			{/if}
			{#if shift.check_in_at}
				<p class="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
					<CircleCheck class="size-4" aria-hidden="true" />
					รายงานตัวแล้ว
				</p>
			{/if}
			{#if needsDispatchResponse(shift)}
				<!--
					The Dispatch Card (CR-092 FR-VOL-06). Answering needs the short code a
					manager reads out on the phone as well as the number this session signed
					in with: the phone alone is guessable, and a declined shift cannot be
					un-declined from here.
				-->
				<div
					class="space-y-2 rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
				>
					<p>ศูนย์เสนอมอบหมายภารกิจนี้ให้คุณ — กรอกรหัสที่เจ้าหน้าที่แจ้งเพื่อตอบรับ</p>
					<Input
						bind:value={codes[shift.assignment_id]}
						placeholder="เช่น 4K7-2M9"
						aria-label="รหัสยืนยันภารกิจ"
						autocomplete="off"
						maxlength={10}
						class="bg-background uppercase"
					/>
					{#if codeErrors[shift.assignment_id]}
						<p class="text-xs text-destructive" role="alert">
							{codeErrors[shift.assignment_id]}
						</p>
					{/if}
					<div class="flex gap-2">
						<Button
							size="sm"
							class="flex-1"
							disabled={answering === shift.assignment_id}
							onclick={() => answer(shift, 'accepted')}
						>
							<Check class="mr-1.5 size-4" aria-hidden="true" />
							ยอมรับภารกิจ
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="flex-1"
							disabled={answering === shift.assignment_id}
							onclick={() => answer(shift, 'declined')}
						>
							<X class="mr-1.5 size-4" aria-hidden="true" />
							ปฏิเสธภารกิจ
						</Button>
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/snippet}

<div class="space-y-6">
	{#if query.isPending}
		<Skeleton class="h-40 w-full rounded-xl" />
	{:else if query.isError}
		<p class="text-sm text-destructive" role="alert">
			{query.error instanceof Error ? query.error.message : 'ไม่สามารถโหลดตารางงานได้'}
		</p>
	{:else if shifts.length === 0}
		<Card.Root>
			<Card.Content class="py-10 text-center text-sm text-muted-foreground">
				ยังไม่มีกะงานที่ได้รับมอบหมาย
			</Card.Content>
		</Card.Root>
	{:else}
		{#if upcoming.length}
			<section class="space-y-3">
				<h2 class="text-sm font-semibold">กะที่กำลังจะถึง</h2>
				{#each upcoming as shift (shift.assignment_id)}
					{@render shiftCard(shift)}
				{/each}
			</section>
		{/if}
		{#if past.length}
			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-muted-foreground">ประวัติการปฏิบัติงาน</h2>
				{#each past as shift (shift.assignment_id)}
					{@render shiftCard(shift)}
				{/each}
			</section>
		{/if}
	{/if}
</div>
