<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { useTransfer } from '../application/queries';
	import type { TransferStatus } from '../domain/operations';
	import {
		transferLineKeys,
		transferSide,
		transferStatusReason,
		transferTimelineSteps,
		type TransferStepKey
	} from '../domain/transfer.view';
	import {
		TRANSFER_SIDE_LABEL,
		TRANSFER_STATUS_LABEL,
		TRANSFER_STEP_LABEL
	} from './transfer-labels';
	import type { Component } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import CirclePause from '@lucide/svelte/icons/circle-pause';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import SearchX from '@lucide/svelte/icons/search-x';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	/**
	 * CR-091 — read-only transfer ticket: route banner, delivery info, item lines and timeline.
	 * No actions live here (FR-05); every rule comes from `domain/transfer.view.ts`.
	 */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	const transferQuery = useTransfer(() => id);

	const transfer = $derived(transferQuery.data);
	const side = $derived(transfer ? transferSide(transfer, getShelterCode()) : undefined);
	const reason = $derived(transfer ? transferStatusReason(transfer) : undefined);
	const steps = $derived(transfer ? transferTimelineSteps(transfer) : []);
	const lineKeys = $derived(transfer ? transferLineKeys(transfer) : []);
	const lines = $derived(
		transfer ? transfer.items.map((item, i) => ({ key: lineKeys[i], item })) : []
	);
	const hasDeliveryInfo = $derived(!!(transfer?.driver_name || transfer?.vehicle_plate));

	const STATUS_TONE: Record<TransferStatus, string> = {
		requested: 'border-sky-200 bg-sky-50 text-sky-900',
		shipped: 'border-sky-200 bg-sky-50 text-sky-900',
		received: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		disputed: 'border-amber-200 bg-amber-50 text-amber-900',
		cancelled: 'border-slate-200 bg-slate-100 text-slate-700'
	};

	const STEP_ICON: Record<TransferStepKey, Component> = {
		requested: FilePlus,
		disputed: CirclePause,
		shipped: Truck,
		received: PackageCheck
	};

	function isReceivedDifferent(qty: string, receivedQty: string): boolean {
		return Number(receivedQty) !== Number(qty);
	}
</script>

<div class="flex flex-col gap-4 sm:gap-6">
	<div class="flex flex-wrap items-center gap-3">
		<a
			href={resolve('/back-office/supply?tab=transfer')}
			class="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<ArrowLeft class="h-4 w-4" />กลับไปรายการโอนย้าย
		</a>
		<h1 class="text-lg font-bold text-slate-900 sm:text-xl">รายละเอียดคำร้องโอนย้าย</h1>
	</div>

	{#if transferQuery.isPending}
		<div class="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
			<Skeleton class="h-8 w-1/2" />
			<Skeleton class="h-5 w-1/3" />
			<Skeleton class="h-24 w-full" />
		</div>
	{:else if transferQuery.isError}
		<div
			class="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-white p-5 shadow-2xs"
		>
			<p class="text-base text-slate-700">โหลดข้อมูลคำร้องไม่สำเร็จ</p>
			<Button variant="outline" class="min-h-11" onclick={() => transferQuery.refetch()}>
				<RefreshCw class="mr-1.5 h-4 w-4" />ลองใหม่
			</Button>
		</div>
	{:else if !transfer}
		<!-- CR-091 D4 — 403 and 404 read the same, so the page never confirms the id exists. -->
		<div
			class="flex flex-col items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs"
			data-testid="transfer-not-found"
		>
			<div class="flex items-center gap-2 text-base font-semibold text-slate-900">
				<SearchX class="h-5 w-5 text-slate-500" />ไม่พบคำร้อง หรือไม่มีสิทธิ์เข้าถึง
			</div>
		</div>
	{:else}
		<!-- Route banner (FR-02) + status and reason (FR-07) -->
		<section
			class="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6"
			data-testid="transfer-banner"
		>
			<div class="flex flex-wrap items-center gap-3">
				<span
					class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
					data-testid="transfer-route"
				>
					{transfer.from_shelter}
					<ArrowRight class="mx-1 inline h-6 w-6 text-slate-400" aria-label="ไปยัง" />
					{transfer.to_shelter}
				</span>
				{#if side}
					<span
						class="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-slate-700"
						data-testid="transfer-side"
					>
						{TRANSFER_SIDE_LABEL[side]}
					</span>
				{/if}
			</div>

			<div class="space-y-1">
				<span
					class="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide {STATUS_TONE[
						transfer.status
					]}"
					data-testid="transfer-status"
				>
					{TRANSFER_STATUS_LABEL[transfer.status]}
				</span>
				{#if reason}
					<p class="text-sm text-slate-700" data-testid="transfer-reason">{reason}</p>
				{/if}
			</div>

			<p class="text-xs break-all text-slate-500">{transfer._id}</p>
		</section>

		<div class="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
			<div class="flex flex-col gap-4 sm:gap-6 lg:col-span-7">
				<!-- Delivery info (FR-03) — hidden entirely when the doc predates CR-089 or is not shipped yet -->
				{#if hasDeliveryInfo}
					<section
						class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
						data-testid="transfer-delivery"
					>
						<h2 class="text-base font-semibold text-slate-800">ข้อมูลการส่งมอบ</h2>
						<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{#if transfer.driver_name}
								<div>
									<dt class="text-sm font-semibold text-slate-500">ผู้ขับรถ</dt>
									<dd class="text-base text-slate-900">{transfer.driver_name}</dd>
								</div>
							{/if}
							{#if transfer.vehicle_plate}
								<div>
									<dt class="text-sm font-semibold text-slate-500">ทะเบียนรถ</dt>
									<dd class="text-base text-slate-900">{transfer.vehicle_plate}</dd>
								</div>
							{/if}
						</dl>
					</section>
				{/if}

				<!-- Item lines (FR-03) — one row per line, never merged by item_id (CR-118 FR-02).
				     CR-118 FR-23 adds the source_lot / dest_lots cells to this table. -->
				<section
					class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
				>
					<h2 class="text-base font-semibold text-slate-800">รายการสินค้า</h2>
					<Table.Root data-testid="transfer-items">
						<Table.Header>
							<Table.Row>
								<Table.Head>รายการ</Table.Head>
								<Table.Head class="text-right">จำนวนส่ง</Table.Head>
								<Table.Head class="text-right">จำนวนรับ</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each lines as line (line.key)}
								<Table.Row>
									<Table.Cell class="text-sm">{line.item.item_id}</Table.Cell>
									<Table.Cell class="text-right text-sm tabular-nums">
										{line.item.qty}
										{line.item.unit}
									</Table.Cell>
									<Table.Cell class="text-right text-sm tabular-nums">
										{#if line.item.received_qty !== undefined}
											<span
												class={isReceivedDifferent(line.item.qty, line.item.received_qty)
													? 'font-semibold text-amber-900'
													: ''}
											>
												{line.item.received_qty}
												{line.item.unit}
											</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</section>

				{#if transfer.notes}
					<section
						class="space-y-2 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
					>
						<h2 class="text-base font-semibold text-slate-800">หมายเหตุ</h2>
						<p class="text-base whitespace-pre-line text-slate-700">{transfer.notes}</p>
					</section>
				{/if}
			</div>

			<!-- Timeline (FR-04) — only the steps on the document, in the fixed order -->
			<section
				class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 lg:col-span-5"
			>
				<h2 class="text-base font-semibold text-slate-800">ลำดับการดำเนินการ</h2>
				<ol class="space-y-4" data-testid="transfer-timeline">
					{#each steps as step (step.key)}
						{@const Icon = STEP_ICON[step.key]}
						<li class="flex gap-3" data-step={step.key}>
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
							>
								<Icon class="h-4 w-4 text-slate-600" />
							</span>
							<div>
								<div class="text-sm font-semibold text-slate-900">
									{TRANSFER_STEP_LABEL[step.key]}
								</div>
								<div class="text-sm text-slate-500 tabular-nums">
									{formatThaiDateTime(step.at)} · {step.by}
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</section>
		</div>
	{/if}
</div>
