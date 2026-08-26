<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Send from '@lucide/svelte/icons/send';
	import type { PendingDonationRow } from '$lib/features/donations';
	import { listShelters, type ShelterSummary } from '$lib/features/shelters';
	import { onMount } from 'svelte';

	let {
		open = false,
		request,
		saving = false,
		onclose,
		onConfirm
	}: {
		open: boolean;
		request: PendingDonationRow | null;
		saving?: boolean;
		onclose: () => void;
		onConfirm: (bookingRef: string, targetShelterCode: string, note: string) => void;
	} = $props();

	let shelters = $state<ShelterSummary[]>([]);
	let loadingShelters = $state(false);
	let sheltersFailed = $state(false);
	let selectedShelter = $state('');
	let note = $state('');
	let error = $state('');

	onMount(async () => {
		try {
			loadingShelters = true;
			shelters = await listShelters();
		} catch {
			shelters = [];
			sheltersFailed = true;
		} finally {
			loadingShelters = false;
		}
	});

	$effect(() => {
		if (open) {
			selectedShelter = '';
			note = '';
			error = '';
		}
	});

	function handleSubmit() {
		if (!request?.booking_ref) return;
		if (!selectedShelter) {
			error = 'กรุณาเลือกศูนย์พักพิงปลายทาง';
			return;
		}
		onConfirm(request.booking_ref, selectedShelter, note.trim());
	}
</script>

{#if open && request}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/50 p-4 backdrop-blur-xs duration-150 fade-in"
		onclick={onclose}
	>
		<div
			class="relative flex w-full max-w-lg animate-in flex-col rounded-2xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between border-b border-border p-5">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
					>
						<Send class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-foreground">ประสานงานส่งต่อ (Redirect)</h3>
						<p class="text-xs text-muted-foreground">รหัสอ้างอิง: {request.booking_ref}</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-4 p-5">
				<p class="text-xs text-muted-foreground">
					สร้างคำร้องส่งต่อรายการบริจาคนี้ไปยังศูนย์พักพิงอื่นที่มีความจำเป็น
					โดยไม่ลงบัญชีคลังที่ศูนย์ปัจจุบัน
				</p>

				<div class="space-y-1.5">
					<label for="shelter-target-select" class="text-xs font-bold text-foreground">
						เลือกศูนย์พักพิงปลายทาง <span class="text-red-500">*</span>
					</label>
					<div class="relative">
						<select
							id="shelter-target-select"
							bind:value={selectedShelter}
							onchange={() => (error = '')}
							disabled={loadingShelters}
							class="w-full rounded-xl border border-border bg-muted/20 p-2.5 text-xs font-medium text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
						>
							<option value=""
								>{loadingShelters
									? 'กำลังโหลดรายชื่อศูนย์…'
									: '-- กรุณาเลือกศูนย์พักพิงปลายทาง --'}</option
							>
							{#each shelters as s (s.code)}
								{#if s.code !== request.shelter_code}
									<option value={s.code}>{s.name} ({s.code})</option>
								{/if}
							{/each}
						</select>
					</div>
					{#if sheltersFailed}
						<p class="text-xs font-bold text-red-600 dark:text-red-400">
							โหลดรายชื่อศูนย์พักพิงไม่สำเร็จ — ปิดหน้าต่างนี้แล้วลองอีกครั้ง
						</p>
					{/if}
					{#if error}
						<p class="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<label for="redirect-note-input" class="text-xs font-bold text-foreground">
						บันทึกหรือข้อตกลงในการส่งต่อ (Optional)
					</label>
					<textarea
						id="redirect-note-input"
						rows="3"
						placeholder="เช่น ศูนย์นี้สิ่งของเกินความจุ ส่งต่อให้ศูนย์ปลายทางที่เปิดรับความต้องการนี้..."
						bind:value={note}
						class="w-full rounded-xl border border-border bg-muted/20 p-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					></textarea>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/10 p-4">
				<button
					type="button"
					onclick={onclose}
					disabled={saving}
					class="cursor-pointer rounded-xl bg-muted px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
				>
					ยกเลิก
				</button>
				<button
					type="button"
					onclick={handleSubmit}
					disabled={saving || loadingShelters}
					class="cursor-pointer rounded-xl bg-[#0c3154] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#124270] disabled:opacity-50"
				>
					{saving ? 'กำลังบันทึก...' : 'ยืนยันการส่งต่อ'}
				</button>
			</div>
		</div>
	</div>
{/if}
