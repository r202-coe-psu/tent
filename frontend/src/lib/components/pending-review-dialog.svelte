<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Truck from '@lucide/svelte/icons/truck';
	import Building from '@lucide/svelte/icons/building';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Phone from '@lucide/svelte/icons/phone';
	import Check from '@lucide/svelte/icons/check';
	import Send from '@lucide/svelte/icons/send';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
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
		open = false,
		request,
		onclose,
		onApprove,
		onForward,
		onReject
	}: {
		open: boolean;
		request: PendingRequest | null;
		onclose: () => void;
		onApprove: (id: string, memo: string) => void;
		onForward: (id: string, memo: string) => void;
		onReject: (id: string, memo: string) => void;
	} = $props();
	let memo = $state('');
</script>

{#if open && request}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/40 p-4 backdrop-blur-xs duration-200 fade-in"
		onclick={onclose}
	>
		<div
			class="relative flex max-h-[95vh] w-full max-w-2xl animate-in flex-col rounded-3xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Modal Header -->
			<div
				class="flex items-start justify-between rounded-t-3xl border-b border-border/20 bg-blue-700 p-6 text-white"
			>
				<div>
					<div class="mb-2 flex items-center gap-2">
						<span class="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-black">
							EOC SAFE GUARD GATE
						</span>
						<span class="text-xs font-medium text-zinc-400">Ref ID: {request.refId}</span>
					</div>
					<h3 class="text-lg font-bold text-white">
						{request.donorName}
						{#if request.donorSubtitle}<span class="font-medium text-amber-400"
								>{request.donorSubtitle}</span
							>{/if}
					</h3>
					<p class="mt-1 text-[11px] text-zinc-400">
						พิจารณาคัดกรองจัดสรรและควบคุมความปลอดภัยก่อนส่งเข้าคลังพัสดุ
					</p>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
				>
					<X class="h-5 w-5" />
				</button>
			</div>
			<!-- Modal Body (Scrollable) -->
			<div class="flex-1 space-y-6 overflow-y-auto p-6">
				<!-- 1. Trigger Reason Alert -->
				<div
					class="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-rose-800 dark:text-rose-300"
				>
					<ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
					<div>
						<h4 class="text-xs font-bold tracking-wider text-rose-600 uppercase dark:text-rose-400">
							ประเด็นความปลอดภัย / การบริหารคลังที่เฝ้าระวัง
						</h4>
						<p class="mt-1 text-xs leading-relaxed font-bold">{request.triggerReason}</p>
					</div>
				</div>
				<!-- 2. Donation Items -->
				<div class="space-y-2">
					<h5 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
						รายการและปริมาณสิ่งของขอบริจาค
					</h5>
					<div
						class="rounded-xl border border-border/40 bg-muted/60 p-4 text-xs leading-relaxed font-bold text-foreground"
					>
						{request.itemsList}
					</div>
				</div>
				<!-- 3. Details statement -->
				<div class="space-y-2">
					<h5 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
						คำชี้แจงและกรณีศึกษาสภาพสิ่งของเพิ่มเติม
					</h5>
					<div
						class="rounded-xl border border-border/40 bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"
					>
						{request.statement}
					</div>
				</div>
				<!-- 4. Detailed Grid (2 Columns) -->
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Truck class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-[10px] font-bold text-muted-foreground uppercase"
								>ยานพาหนะจัดส่ง</span
							>
							<p class="mt-1 text-xs font-semibold text-foreground">{request.vehicle}</p>
						</div>
					</div>
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Building class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-[10px] font-bold text-muted-foreground uppercase"
								>อาคาร/พิกัดเสนอรับเข้า</span
							>
							<p class="mt-1 text-xs font-semibold text-foreground">{request.location}</p>
						</div>
					</div>
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Calendar class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-[10px] font-bold text-muted-foreground uppercase"
								>นัดหมายเสนอรับบริจาค</span
							>
							<p class="mt-1 text-xs font-semibold text-foreground">{request.schedule}</p>
						</div>
					</div>
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Phone class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-[10px] font-bold text-muted-foreground uppercase"
								>ข้อมูลติดต่อประสานงาน</span
							>
							<p class="mt-1 text-xs font-semibold text-foreground">{request.contact}</p>
						</div>
					</div>
				</div>
				<!-- 5. Internal Memo -->
				<div class="space-y-2">
					<label
						for="memo"
						class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
						>บันทึกความเห็นของเจ้าหน้าที่ที่พิจารณา (EOC Official Internal Memo)</label
					>
					<textarea
						id="memo"
						rows="3"
						placeholder="ระบุข้อเสนอแนะเพิ่มเติมสำหรับแจ้งหน่วยคลังย่อย หรือรายละเอียดข้อตกลงการประสานงาน..."
						bind:value={memo}
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					></textarea>
				</div>
			</div>
			<!-- Modal Footer -->
			<div
				class="flex flex-col items-stretch justify-between gap-3 rounded-b-3xl border-t border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center md:px-6"
			>
				<div class="flex w-full items-center gap-2 sm:w-auto">
					<button
						onclick={() => onApprove(request.id, memo)}
						class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 sm:flex-none"
					>
						<Check class="h-4 w-4" />
						อนุมัติรับเข้าคลัง
					</button>
					<button
						onclick={() => onForward(request.id, memo)}
						class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 sm:flex-none"
					>
						<Send class="h-4 w-4" />
						ประสานงานส่งต่อ
					</button>
				</div>
				<div class="flex w-full items-center justify-end gap-2 sm:w-auto">
					<button
						onclick={() => onReject(request.id, memo)}
						class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 sm:flex-none dark:hover:bg-red-950/20"
					>
						<AlertCircle class="h-4 w-4" />
						ปฏิเสธคำขอ
					</button>
					<button
						onclick={onclose}
						class="inline-flex flex-1 cursor-pointer items-center justify-center rounded-xl bg-muted px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-muted/80 sm:flex-none"
					>
						ยกเลิก
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
