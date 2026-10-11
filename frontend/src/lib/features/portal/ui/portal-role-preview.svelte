<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
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
	{#if active}
		<div
			role="status"
			class="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
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

	<!-- Floating dev tool: bottom-left so it never covers page actions on the right. -->
	<Popover.Root bind:open>
		<Popover.Trigger
			class="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {active
				? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
				: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
		>
			<Eye class="size-4" aria-hidden="true" />
			<span>Dev</span>
			{#if active}
				<span class="max-w-32 truncate font-normal">· {roleLabel}</span>
			{/if}
			<span class="sr-only">เปิดเครื่องมือดูในมุมมองบทบาท</span>
		</Popover.Trigger>
		<Popover.Content side="top" align="start" sideOffset={8} class="w-72 gap-3 p-3">
			<div>
				<p class="text-sm font-semibold text-slate-900">ดูในมุมมองบทบาท</p>
				<p class="text-xs text-slate-500">สำหรับตรวจสอบเมนูเท่านั้น สิทธิ์จริงไม่เปลี่ยน</p>
			</div>

			{#if !selectedShelterCode}
				<p class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
					เลือกศูนย์พักพิงก่อนเพื่อดูในมุมมองบทบาท
				</p>
			{/if}

			<div class="space-y-1.5">
				<Label for="portal-preview-role" class="text-xs font-semibold text-slate-700">บทบาท</Label>
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
				<p id="portal-preview-medical-label" class="text-xs font-semibold text-slate-700">
					คัดกรองการแพทย์ของศูนย์
				</p>
				<RadioGroup.Root
					value={preview.medicalScreening}
					onValueChange={setMedical}
					disabled={!available}
					aria-labelledby="portal-preview-medical-label"
					class="grid grid-cols-3 gap-2"
				>
					{#each medicalOptions as option (option.value)}
						<div class="flex min-h-11 items-center gap-2">
							<RadioGroup.Item
								id="portal-preview-medical-{option.value}"
								value={option.value}
								class="size-5"
							/>
							<Label for="portal-preview-medical-{option.value}" class="text-sm text-slate-700">
								{option.label}
							</Label>
						</div>
					{/each}
				</RadioGroup.Root>
			</div>

			{#if active}
				<Button variant="outline" class="min-h-11 w-full" onclick={resetPreview}>
					กลับเป็นมุมมองของฉัน
				</Button>
			{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
