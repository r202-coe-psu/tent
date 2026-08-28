<script lang="ts">
	/**
	 * "ออกสิทธิ์ใช้งานระบบหลังบ้าน" — grant staff system access (owner-approved
	 * mockup, 2026-08-29). Opened from `volunteer-card.svelte`'s per-row
	 * "ออกสิทธิ์ใช้งานระบบ" button.
	 *
	 * Real, persisted: the entered email is saved to `volunteer.user_name` via
	 * `useUpdateVolunteer` (`VolunteerRepository#update()`) — this is the same
	 * field `volunteer-manage-dialog.svelte`'s STAFF SYSTEM ACCESS badge reads.
	 *
	 * Everything else on this screen is deliberately NOT wired, because there is
	 * no backend to wire it to (`volunteer-card.svelte`'s header comment already
	 * flags this): no RoleKey-grant repository call exists (FR-VOL-05R is a
	 * CouchDB-native time-bound grant), which means no `_users` document, no
	 * password, and no role assignment is actually created here. This is a
	 * deliberate scope line, not an oversight — actually minting CouchDB
	 * credentials requires an admin-credentialed server route
	 * (`$lib/server/couch-admin.ts`, `frontend/CONTRIBUTING.md` §4 "do not
	 * bypass"), which doesn't exist yet, and the mockup's "default password =
	 * phone number" is not something to wire up as-is even once that route
	 * exists (guessable default credential) — flagged for the CR alongside the
	 * FR-VOL-05R gap. Role assignment options are still drawn from the real
	 * `STAFF_CAPABILITIES` RoleKey vocabulary (`$lib/auth/roles`) so the picker
	 * shows real capability names, even though selecting one doesn't persist
	 * anything yet.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Mail from '@lucide/svelte/icons/mail';
	import Lock from '@lucide/svelte/icons/lock';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Save from '@lucide/svelte/icons/save';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { STAFF_CAPABILITIES, type StaffCapability } from '$lib/auth/roles';
	import { useUpdateVolunteer } from '../application/queries';
	import type { Volunteer } from '../domain/volunteer.schema';

	let {
		open = $bindable(false),
		volunteer,
		shelterLine
	}: {
		open?: boolean;
		volunteer: Volunteer;
		shelterLine: string;
	} = $props();

	const queryClient = useQueryClient();
	const updateMutation = useUpdateVolunteer(queryClient);

	const ROLE_LABELS: Record<StaffCapability, string> = {
		registration_staff: 'เจ้าหน้าที่ปฏิบัติการทั่วไป (Operations Staff)',
		kitchen_staff: 'เจ้าหน้าที่ครัว (Kitchen Staff)',
		warehouse_staff: 'เจ้าหน้าที่คลังพัสดุ (Warehouse Staff)'
	};

	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());

	let email = $state('');
	let role = $state<StaffCapability>('registration_staff');
	let qrTicketAuth = $state(true);

	let lastOpenedId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		email = volunteer.user_name ?? '';
		role = 'registration_staff';
		qrTicketAuth = true;
		lastOpenedId = volunteer._id;
	});

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	async function submit() {
		const trimmed = email.trim();
		if (!trimmed || !EMAIL_RE.test(trimmed)) {
			toast.error('กรุณากรอกอีเมลให้ถูกต้อง');
			return;
		}
		try {
			await updateMutation.mutateAsync({ ...volunteer, user_name: trimmed });
			toast.success(`บันทึกชื่อผู้ใช้งาน (${trimmed}) แล้ว`);
			toast.info('การสร้างบัญชีเข้าสู่ระบบจริง (รหัสผ่าน/บทบาท/QR) ยังอยู่ระหว่างการพัฒนา');
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div
				class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"
			>
				<KeyRound class="h-4.5 w-4.5" />
			</div>
			<div class="min-w-0">
				<Dialog.Title class="text-base font-bold">ออกสิทธิ์ใช้งานระบบหลังบ้าน</Dialog.Title>
				<p class="text-xs text-muted-foreground">{fullName} ({volunteer.volunteer_code})</p>
			</div>
		</div>

		<div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
			<div class="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
				<p class="text-xs font-bold text-emerald-900">ข้อมูลผู้ใช้งานใหม่ (Auto-filled)</p>
				<div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
					<div>
						<p class="text-emerald-800">ชนิดคน:</p>
						<p class="font-semibold text-foreground">🎫 อาสาสมัคร</p>
					</div>
					<div>
						<p class="text-emerald-800">ชื่อ-นามสกุล:</p>
						<p class="font-semibold text-foreground">{fullName}</p>
					</div>
					<div>
						<p class="text-emerald-800">เบอร์โทรศัพท์ / รหัสผ่านเริ่มต้น:</p>
						<p class="font-semibold text-foreground">{volunteer.phone ?? '—'}</p>
					</div>
					<div>
						<p class="text-emerald-800">สังกัดศูนย์พักพิง:</p>
						<p class="font-semibold text-foreground">{shelterLine}</p>
					</div>
				</div>
			</div>

			<div class="space-y-1.5">
				<p class="text-xs font-bold text-foreground">
					บทบาท/สิทธิ์สำหรับกะงานนี้ (ROLE ASSIGNMENT)
				</p>
				<Select.Root type="single" bind:value={role}>
					<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
						<span class="truncate">{ROLE_LABELS[role]}</span>
					</Select.Trigger>
					<Select.Content>
						{#each STAFF_CAPABILITIES as capability (capability)}
							<Select.Item value={capability} label={ROLE_LABELS[capability]} />
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-[11px] text-muted-foreground">
					* สิทธิ์การใช้งานจะผล Active ต่อเนื่องทันทีหลังบันทึก
					(สามารถเพิกถอนสิทธิ์ได้ทุกเมื่อผ่านปุ่ม [🔒 เพิกถอนสิทธิ์])
				</p>
			</div>

			<div class="space-y-3 rounded-xl border border-border p-4">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<Lock class="h-3.5 w-3.5" />
					กำหนดบัญชีผู้ใช้งานระบบ (AUTHENTICATION &amp; CREDENTIALS)
				</p>

				<div class="space-y-1.5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
							<Mail class="h-3.5 w-3.5" />
							อีเมลสำหรับใช้เป็น Username เข้าสู่ระบบ <span class="text-destructive">*</span>
						</span>
						<Badge variant="outline" class="border-amber-300 text-[10px] text-amber-700">
							กรอกอีเมลเพื่ออัปเดตลงโปรไฟล์อัตโนมัติ
						</Badge>
					</div>
					<Input
						type="email"
						bind:value={email}
						class="h-11"
						placeholder="เช่น volunteer@example.com หรือ volunteer@gmail.com"
					/>
					<p class="text-[11px] text-muted-foreground">
						* เมื่อบันทึก ระบบจะใช้อีเมลนี้เป็น Username เข้าสู่ระบบ
						และบันทึกอัปเดตลงในโปรไฟล์จิตอาสาให้อัตโนมัติ
					</p>
				</div>

				<div class="space-y-1.5 rounded-lg border border-border p-3">
					<p class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						<KeyRound class="h-3.5 w-3.5" />
						รหัสผ่านเริ่มต้น (Default Password):
					</p>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<Badge
							variant="outline"
							class="gap-1.5 border-emerald-300 bg-emerald-50 text-sm text-emerald-800"
						>
							📱 {volunteer.phone ?? '—'}
						</Badge>
						<span class="text-[11px] text-muted-foreground">
							(ใช้เบอร์โทรศัพท์มือถือของอาสาเป็นรหัสผ่าน)
						</span>
					</div>
					<p class="text-[11px] text-muted-foreground">
						ระบบกำหนดให้ใช้ "เบอร์โทรศัพท์มือถือของอาสาสมัคร" เป็นรหัสผ่านเริ่มต้นในการเข้าสู่ระบบ
						เพื่อความสะดวกและง่ายต่อการจดจำ
					</p>
				</div>

				<label
					class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 {qrTicketAuth
						? 'border-primary bg-primary/5'
						: 'border-border'}"
				>
					<Checkbox
						checked={qrTicketAuth}
						onCheckedChange={(v) => (qrTicketAuth = !!v)}
						class="mt-0.5"
					/>
					<span class="min-w-0 text-xs">
						<span class="flex items-center gap-1.5 font-medium text-foreground">
							<QrCode class="h-3.5 w-3.5" />
							อนุญาตให้สแกน QR Code ตั๋วประจำตัวจิตอาสาเพื่อล็อกอินด่วน (Ticket QR Auth)
						</span>
						<span class="mt-0.5 block text-[11px] text-muted-foreground">
							อาสาสมัครสามารถเปิดตั๋วดิจิทัลแล้วให้เจ้าหน้าที่สแกน QR Code
							ประจำตัวเพื่อเข้าสู่ระบบหน้าด่านได้ทันที
						</span>
					</span>
				</label>
			</div>
		</div>

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				type="button"
				class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				disabled={updateMutation.isPending}
				onclick={submit}
			>
				{#if updateMutation.isPending}
					กำลังบันทึก...
				{:else}
					<Save class="h-4 w-4" />
					บันทึกและออกสิทธิ์ใหม่
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
