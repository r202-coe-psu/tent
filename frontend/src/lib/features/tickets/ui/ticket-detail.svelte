<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Flame from '@lucide/svelte/icons/flame';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import User from '@lucide/svelte/icons/user';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiDateTime } from '$lib/utils/date';
	import {
		useTicket,
		useOneStepApproveTicket,
		useDispatchTicket,
		useReceiveTicket,
		useCancelTicket,
		TICKET_STATUS_LABELS,
		type TicketStatus
	} from '$lib/features/tickets';
	import { useMealPlans, toMealPlanMap } from '$lib/features/kitchen';
	import { useRecipes } from '$lib/features/catalog';

	let { id }: { id: string } = $props();

	const ticketQuery = useTicket(() => id);
	const ticket = $derived(ticketQuery.data ?? null);
	const plans = useMealPlans();
	const recipes = useRecipes(() => getShelterCode());
	const planById = $derived(toMealPlanMap(plans.data));
	const plan = $derived(ticket ? (planById[ticket.meal_plan_id] ?? null) : null);
	const recipeChip = $derived.by(() => {
		const recipeId = plan?.recipes?.[0]?.recipe_id;
		if (!recipeId || recipeId === 'recipe:custom') return null;
		const recipe = (recipes.data ?? []).find((r) => r._id === recipeId);
		return recipe ? `สูตร ${recipe.label}` : null;
	});
	const missionTitle = $derived.by(() => {
		if (!ticket) return '';
		const label = plan?.label ?? 'เมนูอาหาร';
		const qty = plan?.allocated_target;
		return `ใบเบิกวัตถุดิบ: ${label}${qty ? ` (${qty} กล่อง)` : ''}`;
	});

	const oneStepApprove = useOneStepApproveTicket();
	const dispatch = useDispatchTicket();
	const receive = useReceiveTicket();
	const cancel = useCancelTicket();

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
	}

	const STATUS_CLASS: Record<TicketStatus, string> = {
		PENDING_PICK: 'border border-amber-200 bg-amber-50 text-amber-900',
		READY_FOR_DISPATCH: 'border border-sky-200 bg-sky-50 text-sky-900',
		IN_TRANSIT: 'border border-indigo-200 bg-indigo-50 text-indigo-900',
		COMPLETED: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
		CANCELLED: 'border border-slate-200 bg-slate-100 text-slate-600'
	};

	// CR-141: kitchen tickets go PENDING_PICK → COMPLETED in one click, so the
	// header badge reads "จ่ายวัตถุดิบและตัดสต็อกแล้ว" once done — READY_FOR_DISPATCH/
	// IN_TRANSIT only still show up on tickets created before this change.
	const HEADER_STATUS_LABEL: Partial<Record<TicketStatus, string>> = {
		PENDING_PICK: 'รอดำเนินการจ่ายวัตถุดิบ',
		COMPLETED: 'จ่ายวัตถุดิบและตัดสต็อกแล้ว'
	};

	async function handleOneStepApprove() {
		if (!ticket) return;
		try {
			await oneStepApprove.mutateAsync({ ticket, ctx: ctx() });
			toast.success('จ่ายวัตถุดิบและตัดสต็อกเรียบร้อยแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
		}
	}

	async function handleDispatch() {
		if (!ticket) return;
		try {
			await dispatch.mutateAsync({ ticket, ctx: ctx() });
			toast.success('ปล่อยของแล้ว — ตัดสต็อกเรียบร้อย');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ปล่อยของไม่สำเร็จ');
		}
	}

	async function handleReceive() {
		if (!ticket) return;
		try {
			await receive.mutateAsync({ ticket, ctx: ctx() });
			toast.success('ยืนยันรับวัตถุดิบแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันรับไม่สำเร็จ');
		}
	}

	async function handleCancel() {
		if (!ticket) return;
		if (!confirm('ยกเลิกตั๋วใบนี้หรือไม่?')) return;
		try {
			await cancel.mutateAsync({ ticket });
			toast.success('ยกเลิกตั๋วแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ');
		}
	}
</script>

<div class="mx-auto max-w-4xl space-y-5 bg-slate-50/60 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<a
			href={resolve('/back-office/tickets/kitchen')}
			class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับหน้ารายการ
		</a>
		{#if ticket && HEADER_STATUS_LABEL[ticket.status]}
			<span
				class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold {STATUS_CLASS[
					ticket.status
				]}"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
				{HEADER_STATUS_LABEL[ticket.status]}
			</span>
		{/if}
	</div>

	{#if ticketQuery.isPending}
		<p class="py-12 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
	{:else if !ticket}
		<p class="py-12 text-center text-sm text-muted-foreground">ไม่พบตั๋วนี้</p>
	{:else}
		<div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:p-5">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-xl font-bold tracking-tight text-slate-900">{missionTitle}</h1>
				<span
					class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 tabular-nums"
				>
					{ticket.ticket_no}
				</span>
			</div>
		</div>

		{#if ticket.status === 'CANCELLED'}
			<div
				class="rounded-lg border border-muted bg-muted/40 p-3 text-center text-sm font-semibold text-muted-foreground"
			>
				ตั๋วนี้ถูกยกเลิกแล้ว
			</div>
		{:else if ticket.status === 'READY_FOR_DISPATCH' || ticket.status === 'IN_TRANSIT'}
			<!-- Historical tickets only (created before CR-141) — walk the old 3-role
			     path since they're already mid-flight through it. -->
			<div
				class="rounded-lg border border-sky-200 bg-sky-50 p-3 text-center text-sm font-semibold text-sky-900"
			>
				ตั๋วนี้เปิดก่อนปรับเป็นอนุมัติคลิกเดียว (CR-141) — ดำเนินการต่อตามขั้นตอนเดิม:
				{TICKET_STATUS_LABELS[ticket.status]}
			</div>
		{/if}

		<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<Card.Header class="border-b pb-4">
				<Card.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
					<ClipboardList class="h-4 w-4 text-sky-600" />
					ข้อมูลการจัดส่งและการประสานงานจุดจัดส่ง
				</Card.Title>
			</Card.Header>
			<Card.Content class="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<p class="flex items-center gap-1 text-muted-foreground">
						<MapPin class="h-3 w-3" />
						จุดหมายปลายทาง
					</p>
					<p class="mt-1 font-semibold text-slate-900">{ticket.destination_location}</p>
				</div>
				<div>
					<p class="flex items-center gap-1 text-muted-foreground">
						<CalendarClock class="h-3 w-3" />
						{ticket.status === 'COMPLETED' ? 'วัน-เวลาที่ส่งมอบ' : 'เวลาเปิดตั๋ว'}
					</p>
					<p class="mt-1 font-semibold text-slate-900">
						{formatThaiDateTime(ticket.updated_at)}
					</p>
				</div>
				<div>
					<p class="flex items-center gap-1 text-muted-foreground">
						<User class="h-3 w-3" />
						เปิดตั๋วโดย
					</p>
					<p class="mt-1 font-semibold text-slate-900">{ticket.requested_by}</p>
				</div>
				<div>
					<p class="flex items-center gap-1 text-muted-foreground">
						<UserCheck class="h-3 w-3" />
						เจ้าหน้าที่ผู้จ่าย/ผู้รับมอบ
					</p>
					<p class="mt-1 font-semibold text-slate-900">
						{ticket.approved_by ?? '—'}
					</p>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<Card.Header class="border-b pb-4">
				<Card.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
					<PackageCheck class="h-4 w-4 text-teal-600" />
					รายการวัตถุดิบและการตัดสต็อก
					{#if recipeChip}
						<span class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700"
							>{recipeChip}</span
						>
					{/if}
				</Card.Title>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-slate-50 hover:bg-slate-50">
							<Table.Head class="text-sm font-semibold text-slate-600">รายการ</Table.Head>
							<Table.Head class="text-right text-sm font-semibold text-slate-600"
								>จำนวนสั่งจ่าย</Table.Head
							>
							<Table.Head class="text-right text-sm font-semibold text-slate-600"
								>ตัดสต็อกแล้ว</Table.Head
							>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each ticket.items as item (item.item_id)}
							<Table.Row>
								<Table.Cell class="text-sm font-semibold text-slate-900"
									>{item.item_name}</Table.Cell
								>
								<Table.Cell class="text-right text-sm text-slate-700 tabular-nums">
									{item.requested_qty}
									{item.unit}
								</Table.Cell>
								<Table.Cell
									class="text-right text-sm font-semibold tabular-nums {item.allocated_qty === '0'
										? 'text-slate-400'
										: 'text-emerald-700'}"
								>
									{item.allocated_qty === '0' ? '—' : `${item.allocated_qty} ${item.unit}`}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		{#if ticket.gas_drawdown && ticket.gas_drawdown.length > 0}
			<Card.Root class="rounded-2xl border border-orange-200 bg-white shadow-xs">
				<Card.Header class="border-b pb-4">
					<Card.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
						<Flame class="h-4 w-4 text-orange-600" />
						แก๊สหุงต้มที่ขอเบิก
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-2 pt-4 text-sm">
					{#each ticket.gas_drawdown as g (g.cylinder_id)}
						<div class="flex items-center justify-between rounded-lg bg-orange-50 px-3 py-2">
							<span class="font-medium text-slate-700">{g.cylinder_id}</span>
							<span class="font-semibold text-orange-800 tabular-nums">{g.qty_kg} kg</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Action bar — role-gated client-side for UX; the CouchDB validate_doc_update
		     guard (shelter-access-design.ts) is the real authorization boundary. -->
		<div
			class="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs"
		>
			<Button variant="outline" onclick={() => goto(resolve('/back-office/tickets/kitchen'))}>
				กลับไปคิวตั๋ว
			</Button>
			<div class="flex flex-wrap items-center gap-2">
				{#if ticket.status === 'PENDING_PICK' || ticket.status === 'READY_FOR_DISPATCH'}
					<Button
						variant="ghost"
						class="text-destructive hover:bg-destructive/10"
						disabled={cancel.isPending}
						onclick={handleCancel}
					>
						ยกเลิกตั๋ว
					</Button>
				{/if}
				{#if ticket.status === 'PENDING_PICK'}
					<Button
						class="gap-2 bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700"
						disabled={oneStepApprove.isPending}
						onclick={handleOneStepApprove}
					>
						<CheckCircle2 class="h-4 w-4" />
						{oneStepApprove.isPending ? 'กำลังดำเนินการ...' : 'อนุมัติและตัดสต็อกแล้ว'}
					</Button>
				{:else if ticket.status === 'READY_FOR_DISPATCH'}
					<Button disabled={dispatch.isPending} onclick={handleDispatch}>
						{dispatch.isPending ? 'กำลังปล่อยของ...' : 'ปล่อยของ (คลัง)'}
					</Button>
				{:else if ticket.status === 'IN_TRANSIT'}
					<Button disabled={receive.isPending} onclick={handleReceive}>
						{receive.isPending ? 'กำลังยืนยัน...' : 'ยืนยันรับวัตถุดิบ (ครัว)'}
					</Button>
				{/if}
			</div>
		</div>
	{/if}
</div>
