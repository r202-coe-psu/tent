<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Mail from '@lucide/svelte/icons/mail';
	import Lock from '@lucide/svelte/icons/lock';
	import Save from '@lucide/svelte/icons/save';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { STAFF_CAPABILITIES, roleOptionLabel, type StaffCapability } from '$lib/auth/roles';
	import { volunteerKeys } from '../application/queries';
	import { grantVolunteerAccess, volunteerAccessSchema } from '../application/volunteer-access';
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
	let pending = $state(false);

	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());

	let email = $state('');
	let role = $state<StaffCapability>('registration_staff');
	let password = $state('');

	let lastOpenedId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		email = volunteer.user_name ?? volunteer.email ?? '';
		role = 'registration_staff';
		password = volunteer.phone ?? '';
		lastOpenedId = volunteer._id;
	});

	async function submit() {
		if (pending) return;
		const parsed = volunteerAccessSchema.safeParse({ email, password, role });
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'กรุณาตรวจสอบข้อมูล');
			return;
		}
		pending = true;
		try {
			const result = await grantVolunteerAccess(volunteer, parsed.data);
			toast.success(
				result.created
					? `สร้างบัญชี (${parsed.data.email}) และออกสิทธิ์แล้ว`
					: `ผูกบัญชี (${parsed.data.email}) แล้ว รหัสผ่านเดิมไม่เปลี่ยนแปลง`
			);
			password = '';
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้างบัญชีไม่สำเร็จ');
		} finally {
			await Promise.allSettled([
				queryClient.invalidateQueries({ queryKey: ['users'] }),
				queryClient.invalidateQueries({ queryKey: volunteerKeys.all })
			]);
			pending = false;
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
						<p class="text-emerald-800">เบอร์โทรศัพท์:</p>
						<p class="font-semibold text-foreground">{volunteer.phone ?? '—'}</p>
					</div>
					<div>
						<p class="text-emerald-800">สังกัดศูนย์พักพิง:</p>
						<p class="font-semibold text-foreground">{shelterLine}</p>
					</div>
				</div>
			</div>

			<div class="space-y-1.5">
				<p class="text-xs font-bold text-foreground">บทบาท/สิทธิ์ใช้งานระบบ (ROLE ASSIGNMENT)</p>
				<Select.Root type="single" bind:value={role} disabled={pending}>
					<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
						<span class="truncate">{roleOptionLabel(role)}</span>
					</Select.Trigger>
					<Select.Content>
						{#each STAFF_CAPABILITIES as capability (capability)}
							<Select.Item value={capability} label={roleOptionLabel(capability)} />
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-[11px] text-muted-foreground">
					* บัญชีใช้สิทธิ์ที่เลือกในศูนย์พักพิงนี้ จัดการสิทธิ์เพิ่มเติมได้ผ่านหน้าผู้ใช้งาน
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
						disabled={pending}
						autocomplete="off"
						aria-label="อีเมลสำหรับเข้าสู่ระบบ"
						class="h-11"
						placeholder="เช่น volunteer@example.com หรือ volunteer@gmail.com"
					/>
					<p class="text-[11px] text-muted-foreground">
						* เมื่อบันทึก ระบบจะใช้อีเมลนี้เป็น Username เข้าสู่ระบบ
						และบันทึกอัปเดตลงในโปรไฟล์จิตอาสาให้อัตโนมัติ
					</p>
				</div>

				<div class="space-y-1.5 rounded-lg border border-border p-3">
					<label
						for={`volunteer-access-password-${volunteer._id}`}
						class="flex items-center gap-1.5 text-xs font-semibold text-foreground"
					>
						<KeyRound class="h-3.5 w-3.5" />
						รหัสผ่านสำหรับบัญชีใหม่ <span class="text-destructive">*</span>
					</label>
					<Input
						id={`volunteer-access-password-${volunteer._id}`}
						type="password"
						bind:value={password}
						disabled={pending}
						autocomplete="new-password"
						class="h-11"
						placeholder="กำหนดรหัสผ่านสำหรับเข้าสู่ระบบ"
					/>
					<p class="text-[11px] text-muted-foreground">
						ค่าเริ่มต้นคือเบอร์โทรศัพท์ของอาสาสมัคร
						และจะบังคับเปลี่ยนรหัสผ่านในการเข้าสู่ระบบครั้งแรก หากเปลี่ยนเป็นรหัสอื่น
						ต้องมีอย่างน้อย 10 ตัวอักษร พร้อมตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ
					</p>
					<p class="text-[11px] text-muted-foreground">
						หากสร้างบัญชีแล้วแต่บันทึกโปรไฟล์ไม่สำเร็จ ให้ลองอีกครั้งด้วยอีเมลและบทบาทเดิม
						ระบบจะผูกบัญชีที่สร้างไว้โดยไม่เปลี่ยนรหัสผ่านเดิม
					</p>
				</div>
			</div>
		</div>

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" disabled={pending} onclick={() => (open = false)}
				>ยกเลิก</Button
			>
			<Button
				type="button"
				class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				disabled={pending}
				onclick={submit}
			>
				{#if pending}
					กำลังบันทึก...
				{:else}
					<Save class="h-4 w-4" />
					บันทึกและออกสิทธิ์ใหม่
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
