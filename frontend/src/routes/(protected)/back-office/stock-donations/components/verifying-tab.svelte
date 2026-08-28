<script lang="ts">
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		formatLotNote,
		generateLotNo,
		useBackOfficeDonation,
		useDonationQueue,
		useReceiveDonationCount,
		type CountedLineInput
	} from '$lib/features/donations';

	/**
	 * "กำลังตรวจรับ (Verifying Drop-off)" — CR-052 §1.2.
	 *
	 * The reconciliation half of the intake split: goods are physically here, so this is
	 * the only tab with quantity inputs. Approving/rejecting/redirecting happens in the
	 * Pending Review tab, which deliberately has none.
	 */

	const STORAGE_ZONES = [
		{ value: 'Zone A', label: 'Zone A (ของใช้ทั่วไป)' },
		{ value: 'Zone B', label: 'Zone B (ของที่เน่าเสียได้)' },
		{ value: 'Zone C', label: 'Zone C (ยาและเวชภัณฑ์)' }
	];

	const DELIVERY_LABELS: Record<string, string> = {
		self_dropoff: 'นำมาส่งเอง',
		parcel: 'ส่งพัสดุ',
		shelter_pickup: 'ศูนย์ไปรับ'
	};

	type CountedRow = {
		key: string;
		name: string;
		item_id?: string;
		free_text?: string;
		declaredQty: string;
		/** qty_str — stays a string end to end (CR-038); never bound to a number input. */
		qty: string;
		unit: string;
		expiry: string;
		zone: string;
		lotNo: string;
	};

	const queue = useDonationQueue(() => 'verifying');

	let selectedRef = $state('');
	const detail = useBackOfficeDonation(() => selectedRef);
	const receiveMutation = useReceiveDonationCount();

	let countedRows = $state<CountedRow[]>([]);
	let remarks = $state('');
	/** The booking the rows in `countedRows` were built from, so a re-fetch of the same
	 *  booking does not wipe counts staff have already keyed in. */
	let loadedRef = $state('');

	$effect(() => {
		const donation = detail.data;
		// Keyed on the ref the queue selected, not on `booking_ref`: a booking that
		// carries none would never match what was stored and would re-seed forever,
		// wiping the counts on every pass.
		if (!donation || selectedRef === loadedRef) return;

		const today = new Date();
		countedRows = donation.items.map((it, i) => ({
			key: `${it.item_id ?? it.free_text ?? 'line'}-${i}`,
			name: it.free_text || it.item_id || 'ไม่ระบุชื่อสินค้า',
			item_id: it.item_id,
			free_text: it.free_text,
			declaredQty: it.qty ?? '0',
			qty: it.qty != null && it.qty !== '' ? String(it.qty) : '0',
			unit: it.unit || 'ชิ้น',
			expiry: '',
			zone: '',
			// One lot per counted line of this drop-off — CR-052 Technical Terms #4.
			lotNo: generateLotNo(today, i + 1)
		}));
		remarks = '';
		loadedRef = selectedRef;
	});

	function closeDetail() {
		selectedRef = '';
		loadedRef = '';
		countedRows = [];
		remarks = '';
	}

	function toCountedLines(): CountedLineInput[] {
		return countedRows.map((row) => ({
			// A line is either a catalog item (item_id → stock ledger) or free text
			// (stays on the donation) — never both (schema.md §2.1).
			...(row.item_id ? { item_id: row.item_id } : { free_text: row.free_text || row.name }),
			qty: row.qty,
			unit: row.unit,
			...(row.item_id
				? {
						lot: {
							...(row.expiry ? { expiry: row.expiry } : {}),
							note: formatLotNote(row.lotNo, row.zone)
						}
					}
				: {})
		}));
	}

	function handleSave() {
		if (!selectedRef || receiveMutation.isPending) return;
		receiveMutation.mutate(
			{ query: selectedRef, items: toCountedLines(), remarks },
			{
				onSuccess: () => {
					toast.success(`บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${selectedRef})`);
					closeDetail();
				},
				onError: (err) => toast.error(err.message)
			}
		);
	}
</script>

<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
	<!-- Queue -->
	<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
		<div
			class="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/5 px-5 py-4"
		>
			<div>
				<h2 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<PackageCheck class="h-4.5 w-4.5 text-primary" />
					กำลังตรวจรับ (Verifying Drop-off)
				</h2>
				<p class="mt-1 text-[11px] text-muted-foreground">
					รายการที่ผ่านการประเมินแล้วและกำลังรอกระทบยอดพัสดุจริงที่ศูนย์
				</p>
			</div>
			<Button
				variant="outline"
				class="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-[11px] font-bold"
				disabled={queue.isFetching}
				onclick={() => queue.refetch()}
			>
				<RefreshCw class="h-3.5 w-3.5 {queue.isFetching ? 'animate-spin' : ''}" />
				รีเฟรช
			</Button>
		</div>

		<div class="divide-y divide-border/50">
			{#if queue.isLoading}
				<p class="px-5 py-8 text-center text-xs text-muted-foreground">กำลังโหลด…</p>
			{:else if queue.isError}
				<p class="px-5 py-8 text-center text-xs text-red-600">{queue.error?.message}</p>
			{:else if (queue.data ?? []).length === 0}
				<p class="px-5 py-8 text-center text-xs text-muted-foreground">
					ยังไม่มีรายการที่รอตรวจรับ
				</p>
			{:else}
				{#each queue.data ?? [] as row (row.booking_ref ?? row.donor_name)}
					<button
						type="button"
						onclick={() => (selectedRef = row.booking_ref ?? '')}
						class="flex w-full cursor-pointer flex-col items-start gap-1.5 px-5 py-3.5 text-left transition-colors hover:bg-muted/30 {selectedRef ===
						row.booking_ref
							? 'bg-primary/5'
							: ''}"
					>
						<div class="flex w-full items-center justify-between gap-2">
							<span
								class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-black"
							>
								{row.booking_ref ?? '—'}
							</span>
							<span class="text-[10px] font-semibold text-muted-foreground">
								{row.item_count} รายการ
							</span>
						</div>
						<span class="text-xs font-bold text-foreground">{row.donor_name || 'ไม่ระบุชื่อ'}</span>
						<span class="text-[11px] text-muted-foreground">
							{row.donor_phone ?? 'ไม่มีเบอร์ติดต่อ'}
							{#if row.delivery_method}
								· {DELIVERY_LABELS[row.delivery_method] ?? row.delivery_method}
							{/if}
							{#if row.slot}
								· {row.slot.date} {row.slot.from}–{row.slot.to}
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Reconciliation -->
	<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
		{#if !selectedRef}
			<div
				class="flex min-h-[360px] flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground"
			>
				<PackageCheck class="h-9 w-9 opacity-40" />
				<p class="text-xs font-semibold">เลือกใบจองทางซ้ายเพื่อกระทบยอดพัสดุจริง</p>
			</div>
		{:else if detail.isLoading}
			<p class="px-5 py-10 text-center text-xs text-muted-foreground">กำลังโหลดรายละเอียด…</p>
		{:else if detail.isError}
			<p class="px-5 py-10 text-center text-xs text-red-600">{detail.error?.message}</p>
		{:else if detail.data}
			<div
				class="flex items-start justify-between border-b border-border/20 bg-zinc-950 p-5 text-white"
			>
				<div>
					<div class="mb-1.5 flex items-center gap-2">
						<span class="text-[9px] font-bold tracking-wide text-zinc-400 uppercase"
							>BOOKING REF.</span
						>
						<span class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-black">
							{detail.data.booking_ref ?? selectedRef}
						</span>
					</div>
					<h3 class="text-sm font-bold text-white">
						ผู้บริจาค: <span class="font-semibold text-amber-400">
							{detail.data.donor?.name || 'ไม่ระบุชื่อ'}
						</span>
					</h3>
				</div>
				<button
					type="button"
					onclick={closeDetail}
					class="cursor-pointer rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
					aria-label="ปิดรายละเอียด"
				>
					<X class="h-4.5 w-4.5" />
				</button>
			</div>

			<div class="space-y-4 p-5">
				<h4 class="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
					กระทบยอดพัสดุรับจริง
				</h4>

				<div class="space-y-2.5">
					{#each countedRows as row (row.key)}
						<div class="rounded-xl border border-border/40 bg-muted/30 p-3">
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<p class="truncate text-xs font-bold text-foreground">{row.name}</p>
									<p class="text-[10px] text-muted-foreground">
										แจ้งไว้ {row.declaredQty}
										{row.unit}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-2">
									<Input
										type="text"
										inputmode="decimal"
										bind:value={row.qty}
										aria-label="จำนวนรับจริงของ {row.name}"
										class="h-8 w-20 rounded-lg bg-card px-2 text-right text-xs font-semibold"
									/>
									<span class="w-12 text-[11px] font-semibold text-muted-foreground">
										{row.unit}
									</span>
								</div>
							</div>

							{#if row.item_id}
								<div class="mt-2.5 grid gap-2 sm:grid-cols-2">
									<label class="flex flex-col gap-1">
										<span class="text-[10px] font-semibold text-muted-foreground">โซนจัดเก็บ</span>
										<select
											bind:value={row.zone}
											class="h-8 w-full cursor-pointer rounded-lg border border-border/80 bg-card px-2 text-[11px] font-semibold text-foreground outline-none focus:border-primary"
										>
											<option value="">เลือกโซนที่เก็บ</option>
											{#each STORAGE_ZONES as zone (zone.value)}
												<option value={zone.value}>{zone.label}</option>
											{/each}
										</select>
									</label>
									<label class="flex flex-col gap-1">
										<span class="text-[10px] font-semibold text-muted-foreground">
											วันหมดอายุ (บังคับเมื่อของหมดอายุได้)
										</span>
										<Input
											type="date"
											bind:value={row.expiry}
											class="h-8 w-full rounded-lg bg-card px-2 text-[11px]"
										/>
									</label>
								</div>
								<p class="mt-2 text-[10px] font-semibold text-muted-foreground">
									เลขล็อต: <span class="font-mono text-foreground">{row.lotNo}</span>
									{#if row.zone}
										<span class="text-muted-foreground"> · {row.zone}</span>
									{/if}
								</p>
							{:else}
								<p class="mt-1.5 text-[10px] text-muted-foreground">
									ไม่มีรหัสสินค้าในคลัง — บันทึกไว้ในใบบริจาค ไม่ตัดยอดเข้าคลัง
								</p>
							{/if}
						</div>
					{/each}
				</div>

				<label class="block">
					<span class="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
						หมายเหตุการตรวจรับ
					</span>
					<Input
						type="text"
						bind:value={remarks}
						placeholder="เช่น ของมาไม่ครบตามที่แจ้ง"
						class="mt-1.5 h-9 rounded-xl text-xs"
					/>
				</label>
			</div>

			<div class="border-t border-border/60 bg-muted/10 p-4">
				<Button
					onclick={handleSave}
					disabled={receiveMutation.isPending || countedRows.length === 0}
					class="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
				>
					<Check class="h-4 w-4" />
					{receiveMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกเข้าคลัง (Stock Ledger)'}
				</Button>
			</div>
		{/if}
	</div>
</div>
