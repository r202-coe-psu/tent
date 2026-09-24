<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Users from '@lucide/svelte/icons/users';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		createDonationSlot,
		editDonationSlot,
		parseCapacityInput,
		slotsOnDate,
		useDonationSlotSchedule,
		useDonations,
		useSaveDonationSlot,
		type DonationSlot,
		type DonationSlotMode
	} from '$lib/features/operations';
	import { DEFAULT_SLOT_WINDOWS, slotBookedCount } from '$lib/features/donations';

	/**
	 * DN-5 — the shelter's own queues (`donation_slot`, schema.md §2.13), kept apart
	 * because they constrain different things:
	 *
	 * · **มาส่งเอง (dropoff)** — the counter takes whoever turns up, so a window here is
	 *   opening hours and normally has no ceiling. A date with no window at all is NOT a
	 *   closed day: `/donate` falls back to the standard windows, which is also what
	 *   `POST /api/public/v1/donations` accepts. To stop taking drop-offs, add the
	 *   window and close it.
	 * · **รถศูนย์ไปรับ (pickup)** — capped by the vehicles the shelter actually has, so
	 *   capacity is required and `SLOT_FULL` guards it. Publishing nothing here means
	 *   the shelter is not collecting that day, and the donor is told so.
	 */

	function todayIso(): string {
		const now = new Date();
		const offsetMs = now.getTimezoneOffset() * 60_000;
		return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
	}

	let mode = $state<DonationSlotMode>('dropoff');
	let selectedDate = $state(todayIso());
	let newFrom = $state('09:00');
	let newTo = $state('10:00');
	// `bind:value` on a number input rewrites this to a number (or `null` when the box
	// is emptied), so it is never only a string.
	let newCapacity = $state<string | number | null>('');
	let newNote = $state('');

	const scheduleQuery = useDonationSlotSchedule();
	const donationsQuery = useDonations();
	const saveSlot = useSaveDonationSlot();

	const slots = $derived(slotsOnDate(scheduleQuery.data ?? [], mode, selectedDate));
	const donations = $derived(donationsQuery.data ?? []);
	const isPickup = $derived(mode === 'pickup');

	/** Blank = no ceiling, which only the drop-off counter may have. */
	function parsedCapacity(): number | null {
		return parseCapacityInput(newCapacity);
	}

	const ctx = $derived({
		shelterCode: getShelterCode(),
		createdBy: authStore.user?.name ?? 'system'
	});

	function bookedOn(slot: DonationSlot): number {
		return slotBookedCount(donations, slot.date, slot.from);
	}

	async function persist(slot: DonationSlot, message: string) {
		try {
			await saveSlot.mutateAsync(slot);
			toast.success(message);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกช่วงเวลาไม่สำเร็จ');
		}
	}

	async function addSlot() {
		if (slots.some((s) => s.from === newFrom)) {
			toast.error(`มีช่วงเวลา ${newFrom} ของวันนี้อยู่แล้ว — แก้ที่รายการด้านล่างแทน`);
			return;
		}
		try {
			const slot = createDonationSlot(
				{
					mode,
					date: selectedDate,
					from: newFrom,
					to: newTo,
					capacity: parsedCapacity(),
					...(newNote.trim() ? { note: newNote } : {})
				},
				ctx
			);
			await persist(slot, `เพิ่มช่วงเวลา ${newFrom} - ${newTo} แล้ว`);
			newNote = '';
		} catch (err) {
			// Zod carries the reason (เวลาสิ้นสุดก่อนเวลาเริ่ม / ความจุต้องมากกว่า 0)
			toast.error(err instanceof Error ? err.message.split('\n')[0] : 'ข้อมูลช่วงเวลาไม่ถูกต้อง');
		}
	}

	/** Seed the five standard windows so a shelter can open a day in one click. */
	async function addStandardDay() {
		const missing = DEFAULT_SLOT_WINDOWS.filter((w) => !slots.some((s) => s.from === w.from));
		if (missing.length === 0) {
			toast.info('วันนี้มีช่วงเวลามาตรฐานครบแล้ว');
			return;
		}
		const capacity = parsedCapacity();
		if (isPickup && capacity === null) {
			toast.error('กรอกจำนวนเที่ยวรถก่อน แล้วค่อยกดเปิดทั้งวัน');
			return;
		}
		for (const window of missing) {
			await persist(
				createDonationSlot(
					{ mode, date: selectedDate, from: window.from, to: window.to, capacity },
					ctx
				),
				`เพิ่มช่วงเวลา ${window.from} - ${window.to} แล้ว`
			);
		}
	}

	async function changeCapacity(slot: DonationSlot, raw: string) {
		const capacity = parseCapacityInput(raw);
		if (capacity === null) {
			if (isPickup) {
				toast.error('คิวรถต้องกำหนดจำนวนเที่ยว');
				return;
			}
			if (slot.capacity === null) return;
			await persist(editDonationSlot(slot, { capacity: null }), `ปลดเพดานช่วง ${slot.from} แล้ว`);
			return;
		}
		if (!Number.isInteger(capacity) || capacity < 1) {
			toast.error('ความจุต้องเป็นจำนวนเต็มมากกว่า 0');
			return;
		}
		if (capacity === slot.capacity) return;
		await persist(
			editDonationSlot(slot, { capacity }),
			`แก้ความจุ ${slot.from} เป็น ${capacity} คิว`
		);
	}

	async function toggleStatus(slot: DonationSlot) {
		const status = slot.status === 'open' ? 'closed' : 'open';
		await persist(
			editDonationSlot(slot, { status }),
			status === 'closed' ? `งดรับช่วง ${slot.from} แล้ว` : `เปิดรับช่วง ${slot.from} แล้ว`
		);
	}
</script>

<div class="space-y-4 md:space-y-6">
	<div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-6">
		<div class="flex items-start gap-3">
			<span class="rounded-xl border border-sky-200 bg-sky-50 p-2 text-sky-700">
				<CalendarClock class="h-5 w-5" />
			</span>
			<div class="space-y-1">
				<h3 class="text-lg font-bold text-slate-900">ช่วงเวลารับของบริจาค</h3>
				<p class="text-sm text-slate-500">
					{#if isPickup}
						รอบรถของศูนย์ที่ออกไปรับของถึงที่ — จำนวนเที่ยวต่อช่วงคือเพดานจริง
						ผู้บริจาคจะจองได้ไม่เกินนี้ วันไหนไม่ตั้งรอบ = วันนั้นศูนย์ไม่ออกไปรับ
					{:else}
						ช่วงมาตรฐานเปิดให้อยู่แล้วทุกวัน ไม่ต้องตั้งอะไรก็รับของได้ —
						ตั้งตรงนี้เฉพาะเมื่อจะปิดบางช่วง ใส่เพดานเฉพาะช่วงที่แน่น หรือเพิ่มช่วงนอกเวลามาตรฐาน
					{/if}
				</p>
			</div>
		</div>

		<!-- คนละข้อจำกัดกัน จึงตั้งค่าแยกกัน: หน้าเคาน์เตอร์รับได้เรื่อยๆ แต่รถศูนย์มีจำกัด -->
		<div class="mt-4 flex flex-wrap gap-2">
			<Button
				variant={isPickup ? 'outline' : 'default'}
				onclick={() => (mode = 'dropoff')}
				class="h-11 sm:h-10"
			>
				<PackageOpen class="mr-1.5 h-4 w-4" />
				ผู้บริจาคมาส่งเอง
			</Button>
			<Button
				variant={isPickup ? 'default' : 'outline'}
				onclick={() => (mode = 'pickup')}
				class="h-11 sm:h-10"
			>
				<Truck class="mr-1.5 h-4 w-4" />
				รถศูนย์ไปรับ
			</Button>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
		<!-- เพิ่มช่วงเวลา -->
		<div
			class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 lg:col-span-5"
		>
			<h4 class="text-base font-semibold text-slate-800">
				{isPickup ? 'เพิ่มรอบรถ' : 'ตั้งค่าช่วงเวลา'}
			</h4>

			<div class="space-y-1.5">
				<Label for="slot-date" class="text-sm font-semibold text-slate-700">วันที่</Label>
				<DatePicker
					id="slot-date"
					ariaLabel="วันที่ของช่วงเวลา"
					bind:value={selectedDate}
					class="h-11 sm:h-10"
				/>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="slot-from" class="text-sm font-semibold text-slate-700">เริ่ม</Label>
					<Input
						id="slot-from"
						type="time"
						step="900"
						bind:value={newFrom}
						class="h-11 tabular-nums sm:h-10"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="slot-to" class="text-sm font-semibold text-slate-700">ถึง</Label>
					<Input
						id="slot-to"
						type="time"
						step="900"
						bind:value={newTo}
						class="h-11 tabular-nums sm:h-10"
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="slot-capacity" class="text-sm font-semibold text-slate-700">
					{#if isPickup}
						จำนวนเที่ยวรถต่อช่วง <span class="text-red-500">*</span>
					{:else}
						จำกัดจำนวนคิว (ไม่บังคับ)
					{/if}
				</Label>
				<Input
					id="slot-capacity"
					type="number"
					min="1"
					placeholder={isPickup ? 'เช่น 2' : 'เว้นว่าง = ไม่จำกัด'}
					bind:value={newCapacity}
					class="h-11 tabular-nums sm:h-10"
				/>
				<p class="text-xs text-slate-500">
					{#if isPickup}
						รถที่ศูนย์ส่งออกไปรับได้จริงในช่วงเวลานี้
					{:else}
						เว้นว่างไว้ได้ — ผู้บริจาคมาส่งเองไม่ต้องแย่งคิวกัน ใส่ตัวเลขเมื่อจุดรับของแน่นจริง
					{/if}
				</p>
			</div>

			<div class="space-y-1.5">
				<Label for="slot-note" class="text-sm font-semibold text-slate-700">หมายเหตุ</Label>
				<Input
					id="slot-note"
					type="text"
					placeholder="เช่น เข้าประตู 2 / จอดรถลานหลัง"
					bind:value={newNote}
					class="h-11 sm:h-10"
				/>
			</div>

			<div class="flex flex-col gap-2 sm:flex-row">
				<Button onclick={addSlot} disabled={saveSlot.isPending} class="h-11 w-full sm:h-10">
					<Plus class="mr-1.5 h-4 w-4" />
					เพิ่มช่วงเวลา
				</Button>
				<Button
					variant="outline"
					onclick={addStandardDay}
					disabled={saveSlot.isPending}
					class="h-11 w-full sm:h-10"
				>
					<Wand class="mr-1.5 h-4 w-4" />
					{isPickup ? 'เปิดรอบรถทั้งวัน' : 'ดึงช่วงมาตรฐานมาแก้'}
				</Button>
			</div>
		</div>

		<!-- ช่วงเวลาของวันที่เลือก -->
		<div
			class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 lg:col-span-7"
		>
			<div class="flex items-baseline justify-between gap-2">
				<h4 class="text-base font-semibold text-slate-800">ช่วงเวลาวันที่ {selectedDate}</h4>
				<span class="text-sm text-slate-500 tabular-nums">{slots.length} ช่วง</span>
			</div>

			{#if scheduleQuery.isPending}
				<p class="py-8 text-center text-sm text-slate-500">กำลังโหลดช่วงเวลา...</p>
			{:else if slots.length === 0}
				<div class="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
					<p class="text-sm font-semibold text-slate-700">
						{isPickup ? 'ยังไม่มีรอบรถของวันนี้' : 'ยังไม่ได้ตั้งค่าอะไรของวันนี้'}
					</p>
					<p class="mt-1 text-xs text-slate-500">
						หน้าบริจาคเปิดช่วงมาตรฐาน 5 ช่วงแบบไม่จำกัดคิวอยู่แล้ว — ปกติไม่ต้องทำอะไรตรงนี้
					</p>
				</div>
			{:else}
				<ul class="space-y-2.5">
					{#each slots as slot (slot._id)}
						{@const booked = bookedOn(slot)}
						{@const isClosed = slot.status === 'closed'}
						{@const isFull = slot.capacity !== null && booked >= slot.capacity}
						<li
							class="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between
								{isClosed ? 'border-slate-300' : isFull ? 'border-amber-200' : 'border-emerald-200'}"
						>
							<div class="space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-base font-bold text-slate-900 tabular-nums">
										{slot.from} - {slot.to}
									</span>
									{#if isClosed}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
										>
											<Lock class="h-3.5 w-3.5" />
											งดรับ
										</span>
									{:else if isFull}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
										>
											<Users class="h-3.5 w-3.5" />
											คิวเต็ม
										</span>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
										>
											<Users class="h-3.5 w-3.5" />
											เปิดรับ
										</span>
									{/if}
								</div>
								<p class="text-sm text-slate-600">
									จองแล้ว <span class="font-semibold tabular-nums">{booked}</span>
									{#if slot.capacity === null}
										คิว · ไม่จำกัด
									{:else}
										/ <span class="tabular-nums">{slot.capacity}</span>
										{isPickup ? 'เที่ยว' : 'คิว'}
									{/if}
									{#if slot.note}
										<span class="text-slate-400"> · {slot.note}</span>
									{/if}
								</p>
							</div>

							<div class="flex items-center gap-2">
								<Label for="cap-{slot._id}" class="sr-only">ความจุของช่วง {slot.from}</Label>
								<Input
									id="cap-{slot._id}"
									type="number"
									min="1"
									placeholder={isPickup ? '' : 'ไม่จำกัด'}
									value={slot.capacity ?? ''}
									onchange={(e) => changeCapacity(slot, e.currentTarget.value)}
									class="h-11 w-24 tabular-nums sm:h-10"
								/>
								<Button
									variant="outline"
									onclick={() => toggleStatus(slot)}
									disabled={saveSlot.isPending}
									class="h-11 shrink-0 sm:h-10"
								>
									{#if isClosed}
										<LockOpen class="mr-1.5 h-4 w-4" />
										เปิดรับ
									{:else}
										<Lock class="mr-1.5 h-4 w-4" />
										งดรับ
									{/if}
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>
