<script lang="ts">
	/**
	 * "ระบบโอนย้ายกำลังพลและอาสาสมัครข้ามศูนย์" — request/accept flow
	 * (CR-094 §3.5 / schema.md §2.20 `volunteer_transfer`, owner-approved
	 * mockup 2026-08-28).
	 *
	 * `VolunteerTransferRepository#decide` deliberately does NOT touch
	 * `volunteer.current_shelter_code` or revoke the origin's access grant yet
	 * (TODO(D-VOL-TRANSFER-APPROVE), CR-094 §7 open) — approving here only
	 * flips the `volunteer_transfer` doc's `status`. The list split below is
	 * also best-effort for the same open reason: `list()` only ever reads the
	 * *active* shelter's CouchDB, so "คำขอโอนย้ายออกจากศูนย์นี้" only shows up
	 * here if the request doc happens to live in this shelter's DB — until
	 * D-VOL-TRANSFER-APPROVE is closed there is no guarantee the destination
	 * shelter can see a request some other shelter made about it, or vice
	 * versa. Flagged for the CR.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import Zap from '@lucide/svelte/icons/zap';
	import Send from '@lucide/svelte/icons/send';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelters } from '$lib/features/shelters';
	import {
		useTransfers,
		useDecideTransfer,
		useCancelTransfer,
		useRequestTransfer,
		useVolunteers
	} from '../application/queries';
	import type { VolunteerTransfer } from '../domain/volunteer-transfer.schema';

	let {
		open = $bindable(false),
		presetVolunteerId = null
	}: { open?: boolean; presetVolunteerId?: string | null } = $props();

	const queryClient = useQueryClient();
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const transfersQuery = useTransfers({ status: 'pending' });
	const sheltersQuery = useShelters();
	const volunteersQuery = useVolunteers();

	const incoming = $derived(
		(transfersQuery.data ?? []).filter((t) => t.to_shelter_code === shelterCode)
	);
	const outgoing = $derived(
		(transfersQuery.data ?? []).filter((t) => t.from_shelter_code === shelterCode)
	);

	function shelterLabel(code: string): string {
		return sheltersQuery.data?.find((s) => s.code === code)?.name ?? code;
	}
	function volunteerLabel(id: string): { name: string; code: string; skills: string[] } {
		const v = volunteersQuery.data?.find((v) => v._id === id);
		return v
			? { name: `${v.first_name} ${v.last_name}`, code: v.volunteer_code, skills: v.skills }
			: { name: id, code: '—', skills: [] };
	}

	type View = 'incoming' | 'outgoing' | 'new';
	let view = $state<View>('incoming');

	const decideMutation = useDecideTransfer(queryClient);
	async function decide(id: string, decision: 'accepted' | 'rejected') {
		try {
			await decideMutation.mutateAsync({ id, decision });
			toast.success(decision === 'accepted' ? 'อนุมัติรับตัวเข้าศูนย์แล้ว' : 'ปฏิเสธคำขอแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');
		}
	}

	const cancelMutation = useCancelTransfer(queryClient);
	async function cancelRequest(id: string) {
		try {
			await cancelMutation.mutateAsync(id);
			toast.success('ยกเลิกคำขอแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยกเลิกคำขอไม่สำเร็จ');
		}
	}

	// New-request sub-form
	let newVolunteerId = $state('');
	let newToShelter = $state('');
	let newReason = $state('');
	let newNote = $state('');
	const requestMutation = useRequestTransfer(queryClient);

	/** Quick-fill chips for the reason textarea — append, don't replace what's already typed. */
	const REASON_EXAMPLES = [
		'เสริมกำลังภารกิจเร่งด่วน',
		'ผู้ปฏิบัติงานย้ายที่พักใกล้ศูนย์ปลายทาง',
		'สนับสนุนทักษะเฉพาะทางตามคำร้องขอ',
		'สลับสับเปลี่ยนกำลังพลตามรอบ'
	];
	function appendReasonExample(example: string) {
		if (newReason.includes(example)) return;
		newReason = newReason.trim() ? `${newReason.trim()}, ${example}` : example;
	}

	// Opened from a roster row's "ขอโอนย้ายศูนย์" button (`volunteer-card.svelte`) —
	// jump straight to the new-request sub-form with that volunteer preselected,
	// instead of the default incoming-requests view.
	let lastPresetVolunteerId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastPresetVolunteerId = null;
			return;
		}
		if (!presetVolunteerId || lastPresetVolunteerId === presetVolunteerId) return;
		view = 'new';
		newVolunteerId = presetVolunteerId;
		lastPresetVolunteerId = presetVolunteerId;
	});

	function resetNewForm() {
		newVolunteerId = '';
		newToShelter = '';
		newReason = '';
		newNote = '';
	}

	async function submitNewRequest() {
		if (!newVolunteerId || !newToShelter) {
			toast.error('กรุณาเลือกอาสาสมัครและศูนย์ปลายทาง');
			return;
		}
		if (!newReason.trim()) {
			toast.error('กรุณากรอกเหตุผลและความจำเป็นในการขอโอนย้าย');
			return;
		}
		// `หมายเหตุเพิ่มเติม` has no field of its own on `VolunteerTransferInput`
		// (schema.md §2.20 only has `reason`) — fold it into the same string
		// rather than silently dropping whatever staff typed there.
		const reason = newNote.trim()
			? `${newReason.trim()}\n\nหมายเหตุ: ${newNote.trim()}`
			: newReason.trim();
		try {
			await requestMutation.mutateAsync({
				volunteer_id: newVolunteerId,
				from_shelter_code: shelterCode,
				to_shelter_code: newToShelter,
				reason
			});
			toast.success('ยื่นคำขอโอนย้ายแล้ว');
			resetNewForm();
			view = 'outgoing';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยื่นคำขอไม่สำเร็จ');
		}
	}

	const STATUS_LABEL: Record<VolunteerTransfer['status'], string> = {
		pending: 'รอการพิจารณารับตัว',
		accepted: 'อนุมัติแล้ว',
		rejected: 'ปฏิเสธแล้ว',
		cancelled: 'ยกเลิกแล้ว'
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
		<div class="bg-primary-dark px-6 py-5 text-white">
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold">
				<div class="grid h-9 w-9 place-items-center rounded-xl bg-white/10">
					<ArrowLeftRight class="h-4.5 w-4.5" />
				</div>
				ระบบโอนย้ายกำลังพลและอาสาสมัครข้ามศูนย์
				<Badge variant="outline" class="border-white/30 text-[10px] text-white/80">
					REQUEST-ACCEPT FLOW
				</Badge>
			</Dialog.Title>
			<p class="mt-1 text-xs text-white/60">
				กระบวนการขอ-รับตัวกำลังพลระหว่างศูนย์พักพิง (ต้นทางยื่นคำขอ — ปลายทางกดรับตัวเข้าสังกัด)
			</p>
			<p class="mt-2 text-xs text-white/70">
				ศูนย์ปฏิบัติงานปัจจุบัน: <span class="font-bold text-white"
					>{shelterLabel(shelterCode)}</span
				>
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
			<Button
				size="sm"
				variant={view === 'incoming' ? 'default' : 'outline'}
				class="gap-1.5"
				onclick={() => (view = 'incoming')}
			>
				คำขอโอนย้ายเข้าศูนย์นี้
				<Badge variant="secondary" class="text-[10px]">{incoming.length}</Badge>
			</Button>
			<Button
				size="sm"
				variant={view === 'outgoing' ? 'default' : 'outline'}
				class="gap-1.5"
				onclick={() => (view = 'outgoing')}
			>
				คำขอโอนย้ายออกจากศูนย์นี้
				<Badge variant="secondary" class="text-[10px]">{outgoing.length}</Badge>
			</Button>
			<Button size="sm" variant="ghost" class="ml-auto gap-1.5" onclick={() => (view = 'new')}>
				<Zap class="h-3.5 w-3.5" />
				ยื่นคำขอโอนย้ายใหม่
			</Button>
		</div>

		<div class="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-4">
			{#if view === 'new'}
				<div class="space-y-4 rounded-xl border border-border p-4">
					<div class="flex items-start gap-2">
						<div
							class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
						>
							<Send class="h-4 w-4" />
						</div>
						<div class="min-w-0">
							<p class="text-sm font-bold text-foreground">
								แบบฟอร์มยื่นคำขอโอนย้ายกำลังพลข้ามศูนย์
							</p>
							<p class="text-xs text-muted-foreground">
								ระบุบุคคลและศูนย์ปลายทาง พร้อมเหตุผลความจำเป็นในการขอโอนย้าย
							</p>
						</div>
					</div>

					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-foreground">
							เลือกจิตอาสา / เจ้าหน้าที่ต้นทาง <span class="text-destructive">*</span>
						</span>
						<Select.Root type="single" bind:value={newVolunteerId}>
							<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
								<span class="truncate">
									{newVolunteerId
										? `${volunteerLabel(newVolunteerId).name} (${volunteerLabel(newVolunteerId).code})`
										: '-- กรุณาเลือกบุคคลจากศูนย์นี้ --'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each volunteersQuery.data ?? [] as v (v._id)}
									<Select.Item
										value={v._id}
										label={`${v.first_name} ${v.last_name} (${v.volunteer_code})`}
									/>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-foreground">
							ศูนย์พักพิงปลายทางที่ต้องการส่งตัวไป <span class="text-destructive">*</span>
						</span>
						<Select.Root type="single" bind:value={newToShelter}>
							<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
								<span class="truncate">
									{newToShelter ? shelterLabel(newToShelter) : '-- กรุณาเลือกศูนย์ปลายทาง --'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each (sheltersQuery.data ?? []).filter((s) => s.code !== shelterCode) as s (s.code)}
									<Select.Item value={s.code} label={s.name} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-foreground">
							เหตุผลและความจำเป็นในการขอโอนย้าย <span class="text-destructive">*</span>
						</span>
						<Textarea
							bind:value={newReason}
							rows={3}
							placeholder="เช่น ต้องการเสริมทัพด้านปฐมพยาบาลในพื้นที่ลุ่มต่ำ, อาสาสมัครย้ายที่พักชั่วคราวมาใกล้ศูนย์ปลายทาง..."
						/>
						<div class="flex flex-wrap items-center gap-1.5 text-[11px]">
							<span class="text-muted-foreground">ตัวอย่างเหตุผล:</span>
							{#each REASON_EXAMPLES as example (example)}
								<button
									type="button"
									class="rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
									onclick={() => appendReasonExample(example)}
								>
									+ {example}
								</button>
							{/each}
						</div>
					</div>
					<div class="space-y-1.5">
						<span class="text-xs font-semibold text-foreground">
							หมายเหตุเพิ่มเติม / ข้อควรระวัง (ไม่บังคับ)
						</span>
						<Input
							bind:value={newNote}
							class="h-11"
							placeholder="เช่น มีทักษะขับรถกระบะยกสูง, สะดวกปฏิบัติงานเฉพาะกลางวัน"
						/>
					</div>

					<div
						class="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-amber-900"
					>
						<p class="flex items-center gap-1.5 text-xs font-semibold">
							<ShieldCheck class="h-3.5 w-3.5" />
							กฎการโอนย้าย (Pattern Request-Accept Flow):
						</p>
						<ul class="list-disc space-y-1 pl-5 text-[11px]">
							<li>
								คำขอนี้จะเข้าคิวที่ศูนย์ปลายทาง และจะมีผลสมบูรณ์เมื่อ SM ศูนย์ปลายทางกด
								"อนุมัติรับตัว" เท่านั้น
							</li>
							<li>เมื่อรับตัวสำเร็จ สังกัด (affiliation) จะเปลี่ยนเป็นศูนย์ใหม่โดยอัตโนมัติ</li>
							<li>
								กะเดิมที่ศูนย์เก่าที่ยังไม่เริ่มจะถูกยกเลิก
								แต่ประวัติการทำงานเดิมจะถูกเก็บรักษาไว้อย่างครบถ้วน
							</li>
						</ul>
					</div>

					<div class="flex justify-end gap-2">
						<Button variant="outline" onclick={() => (view = 'outgoing')}>
							ดูรายการคำขอทั้งหมด
						</Button>
						<Button
							class="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
							disabled={requestMutation.isPending}
							onclick={submitNewRequest}
						>
							<Send class="h-3.5 w-3.5" />
							ยื่นคำขอโอนย้ายไปยังศูนย์ปลายทาง
						</Button>
					</div>
				</div>
			{:else}
				{@const list = view === 'incoming' ? incoming : outgoing}
				{#if transfersQuery.isPending}
					<p class="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
				{:else if list.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground">
						ไม่มีคำขอโอนย้าย{view === 'incoming' ? 'เข้า' : 'ออกจาก'}ศูนย์นี้ในขณะนี้
					</p>
				{:else}
					{#each list as t (t._id)}
						{@const applicant = volunteerLabel(t.volunteer_id)}
						<div class="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant="outline" class="text-[11px]">{applicant.code}</Badge>
								<span class="text-sm font-bold text-foreground">{applicant.name}</span>
								<Badge variant="outline" class="ml-auto gap-1 border-amber-300 text-amber-700">
									{STATUS_LABEL[t.status]}
								</Badge>
							</div>
							<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<span
									>ศูนย์ต้นทาง: <b class="text-foreground">{shelterLabel(t.from_shelter_code)}</b
									></span
								>
								<ArrowLeftRight class="h-3.5 w-3.5" />
								<span
									>ศูนย์ปลายทาง: <b class="text-foreground">{shelterLabel(t.to_shelter_code)}</b
									></span
								>
							</div>
							{#if t.reason}
								<p class="mt-2 text-xs text-foreground">เหตุผลการโอนย้าย: {t.reason}</p>
							{/if}
							{#if applicant.skills.length > 0}
								<div class="mt-2 flex flex-wrap gap-1">
									{#each applicant.skills as skill (skill)}
										<Badge variant="outline" class="text-[10px]">{skill}</Badge>
									{/each}
								</div>
							{/if}
							<p class="mt-2 text-[11px] text-muted-foreground">
								ยื่นคำขอโดย {t.requested_by} · {new Date(t.created_at).toLocaleString('th-TH')}
							</p>

							{#if t.status === 'pending'}
								<div class="mt-3 flex justify-end gap-2">
									{#if view === 'incoming'}
										<Button
											size="sm"
											variant="outline"
											class="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
											onclick={() => decide(t._id, 'rejected')}
										>
											<X class="h-3.5 w-3.5" />
											ปฏิเสธคำขอ
										</Button>
										<Button
											size="sm"
											class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
											onclick={() => decide(t._id, 'accepted')}
										>
											<Check class="h-3.5 w-3.5" />
											อนุมัติรับตัวเข้าศูนย์
										</Button>
									{:else}
										<Button size="sm" variant="outline" onclick={() => cancelRequest(t._id)}>
											ยกเลิกคำขอ
										</Button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
