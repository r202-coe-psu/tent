<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import * as Select from '$lib/components/ui/select';
	import { isSystemAdmin } from '$lib/auth/roles';
	import {
		PORTAL_PREVIEW_ROLES,
		createPortalPreviewState,
		isPortalPreviewActive,
		isPortalPreviewAvailable,
		portalPreviewRoleLabel,
		type PortalMedicalPreview,
		type PortalPreviewRole,
		type PortalPreviewState
	} from '../domain/portal-preview';

	interface Props {
		/** The signed-in user's real roles. The control renders only for a system admin. */
		realRoles: readonly string[];
		selectedShelterCode: string | null | undefined;
		/** Preview choice, owned by the page. Component state only: never persisted. */
		preview: PortalPreviewState;
	}

	let { realRoles, selectedShelterCode, preview = $bindable() }: Props = $props();

	const eligible = $derived(isSystemAdmin(realRoles));
	const available = $derived(isPortalPreviewAvailable(realRoles, selectedShelterCode));
	const active = $derived(available && isPortalPreviewActive(preview));
	const roleLabel = $derived(portalPreviewRoleLabel(preview.role));

	const medicalOptions: readonly { value: PortalMedicalPreview; label: string }[] = [
		{ value: 'real', label: 'ตามศูนย์' },
		{ value: 'on', label: 'เปิด' },
		{ value: 'off', label: 'ปิด' }
	];
	const medicalDetail = $derived(
		preview.medicalScreening === 'real'
			? ''
			: ` · คัดกรองการแพทย์: ${medicalOptions.find((o) => o.value === preview.medicalScreening)?.label ?? ''}`
	);

	let open = $state(false);

	function setRole(value: string | undefined) {
		if (!value) return;
		preview = { ...preview, role: value as PortalPreviewRole };
	}

	function setMedical(value: string | undefined) {
		if (!value) return;
		preview = { ...preview, medicalScreening: value as PortalMedicalPreview };
	}

	function resetPreview() {
		preview = createPortalPreviewState();
	}
</script>

{#if eligible}
	<div class="mb-6 space-y-3">
		<div class="flex justify-end">
			<Button
				variant="ghost"
				class="min-h-11 gap-2 text-slate-700"
				aria-expanded={open}
				aria-controls="portal-role-preview-panel"
				onclick={() => (open = !open)}
			>
				<Eye class="size-4" aria-hidden="true" />
				ดูในมุมมองบทบาท
			</Button>
		</div>

		{#if open}
			<div
				id="portal-role-preview-panel"
				class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
			>
				<p class="text-sm text-slate-600">
					ดูเมนูของบทบาทอื่นเพื่อตรวจสอบเท่านั้น สิทธิ์จริงของคุณจะไม่เปลี่ยน
				</p>

				{#if !selectedShelterCode}
					<p
						class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
					>
						เลือกศูนย์พักพิงก่อนเพื่อดูในมุมมองบทบาท
					</p>
				{/if}

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="portal-preview-role" class="text-sm font-semibold text-slate-700">
							บทบาทที่จะดู
						</Label>
						<Select.Root
							type="single"
							value={preview.role}
							onValueChange={setRole}
							disabled={!available}
						>
							<Select.Trigger id="portal-preview-role" class="h-11 w-full">
								<span class="truncate">{roleLabel}</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each PORTAL_PREVIEW_ROLES as option (option.value)}
										<Select.Item value={option.value} label={option.label}>
											{option.label}
										</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
					</div>

					<div class="space-y-1.5">
						<p id="portal-preview-medical-label" class="text-sm font-semibold text-slate-700">
							คัดกรองการแพทย์ของศูนย์
						</p>
						<RadioGroup.Root
							value={preview.medicalScreening}
							onValueChange={setMedical}
							disabled={!available}
							aria-labelledby="portal-preview-medical-label"
							class="grid grid-cols-1 gap-2 sm:grid-cols-3"
						>
							{#each medicalOptions as option (option.value)}
								<div class="flex min-h-11 items-center gap-3">
									<RadioGroup.Item
										id="portal-preview-medical-{option.value}"
										value={option.value}
										class="size-5"
									/>
									<Label
										for="portal-preview-medical-{option.value}"
										class="text-sm font-medium text-slate-700"
									>
										{option.label}
									</Label>
								</div>
							{/each}
						</RadioGroup.Root>
					</div>
				</div>
			</div>
		{/if}

		{#if active}
			<div
				role="status"
				class="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex items-start gap-3">
					<TriangleAlert class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
					<p class="text-base leading-relaxed">
						<span class="font-semibold">กำลังดูในมุมมอง: {roleLabel}{medicalDetail}</span>
						— สิทธิ์จริงของคุณไม่เปลี่ยน ลิงก์ยังเปิดด้วยสิทธิ์ผู้ดูแลระบบ
					</p>
				</div>
				<Button
					variant="outline"
					class="min-h-11 shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
					onclick={resetPreview}
				>
					กลับเป็นมุมมองของฉัน
				</Button>
			</div>
		{/if}
	</div>
{/if}
