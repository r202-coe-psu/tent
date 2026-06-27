<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	interface PendingRequest {
		id: string;
		donorName: string;
		donorSubtitle: string;
		refId: string;
		submittedTime: string;
		triggerReason: string;
		itemsList: string;
		statement: string;
		vehicle: string;
		location: string;
		schedule: string;
		contact: string;
	}
	let {
		requests = [],
		onViewDetails
	}: {
		requests: PendingRequest[];
		onViewDetails: (request: PendingRequest) => void;
	} = $props();
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Section Header -->
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<ClipboardCheck class="h-5 w-5 text-primary" />
				รายการรอตรวจสอบความเหมาะสม (Pending Review Board)
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				ระบบกรองอนุมัติคำขอบริจาคพิเศษที่มีน้ำหนักหรือคุณสมบัติจำเป็นต้องให้ส่วนกลางประเมินพื้นที่คลังและการกระจายพัสดุก่อนรับเข้าจริง
			</p>
		</div>
	</div>
	<!-- Requests Table -->
	<div class="overflow-x-auto">
		<Table.Root class="w-full border-collapse text-left">
			<Table.Header>
				<Table.Row
					class="border-b border-border bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Table.Head class="px-6 py-4">ผู้ส่งและรหัสคำขอ (DONOR INFO)</Table.Head>
					<Table.Head class="px-6 py-4">ประเด็นการตรวจสอบ (TRIGGER REASON)</Table.Head>
					<Table.Head class="px-6 py-4 text-center">การจัดการคำขอ (ACTION)</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border/60 text-xs">
				{#each requests as req (req.id)}
					<Table.Row class="transition-colors hover:bg-muted/5">
						<!-- Donor Info Column -->
						<Table.Cell class="min-w-[280px] px-6 py-4">
							<div class="text-sm font-bold text-foreground">
								{req.donorName}
								{#if req.donorSubtitle}
									<span class="ml-1 text-xs font-medium text-muted-foreground"
										>{req.donorSubtitle}</span
									>
								{/if}
							</div>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<span
									class="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
								>
									รอพิจารณาความปลอดภัย
								</span>
								<span
									class="rounded border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
								>
									{req.refId}
								</span>
								<span class="text-[10px] text-muted-foreground">
									• ส่งเมื่อ {req.submittedTime}
								</span>
							</div>
						</Table.Cell>
						<!-- Trigger Reason Column -->
						<Table.Cell class="min-w-[320px] px-6 py-4">
							<div
								class="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-[11px] font-bold text-rose-800 dark:text-rose-300"
							>
								<AlertTriangle class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
								<span>{req.triggerReason}</span>
							</div>
						</Table.Cell>
						<!-- Action Column -->
						<Table.Cell class="px-6 py-4 text-center">
							<Button
								onclick={() => onViewDetails(req)}
								class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
							>
								<Search class="h-3.5 w-3.5" />
								ดูรายละเอียด
							</Button>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={3} class="px-6 py-12 text-center text-muted-foreground">
							ไม่มีรายการที่อยู่ระหว่างการรอตรวจสอบความเหมาะสม
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
