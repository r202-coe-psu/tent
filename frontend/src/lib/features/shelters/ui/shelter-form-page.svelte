<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		useShelter,
		useCreateShelter,
		useUpdateShelter,
		shelterSchema,
		BasicInfoSection,
		CapacitySection,
		ZonesFacilitiesSection,
		UtilitiesSection,
		RiskSection
	} from '$lib/features/shelters';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Save from '@lucide/svelte/icons/save';

	let {
		id = '',
		isEdit
	}: {
		id?: string;
		isEdit: boolean;
	} = $props();

	const shelterQuery = useShelter(() => id);
	const createMutation = useCreateShelter();
	const updateMutation = useUpdateShelter();

	const form = superForm(defaults(zod4(shelterSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(shelterSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
				return;
			}

			const data = validated.data;

			if (isEdit) {
				updateMutation.mutate(
					{ code: id, input: data },
					{
						onSuccess: () => {
							goto(resolve('/back-office/shelters'));
						}
					}
				);
			} else {
				createMutation.mutate(data, {
					onSuccess: () => {
						goto(resolve('/back-office/shelters'));
					}
				});
			}
		}
	});

	const { form: formData, submitting, enhance } = form;

	// Ensure nested optional objects exist so child sections can bind safely
	$effect(() => {
		if (!$formData.location) $formData.location = {};
		if (!$formData.contact) $formData.contact = {};
	});

	// Populate form data when edit query loads
	$effect(() => {
		if (shelterQuery.data) {
			const d = shelterQuery.data;
			$formData = {
				name: d.name,
				operation_status: d.operation_status,
				shelter_type: d.shelter_type ?? null,
				location: d.location ?? {},
				contact: d.contact ?? {},
				capacity: d.capacity,
				area_m2: d.area_m2 ?? null,
				area_type: d.area_type ?? null,
				facilities: d.facilities ?? {},
				common_areas: d.common_areas ?? { sub_storage: [] },
				utilities: d.utilities ?? { communications: [] },
				risk: d.risk ?? {},
				zones: d.zones ?? []
			};
		}
	});

	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	const isLoading = $derived(isEdit ? shelterQuery.isLoading : false);
	const isError = $derived(isEdit ? shelterQuery.isError : false);
	const errorMessage = $derived(isEdit ? (shelterQuery.error?.message ?? '') : '');
</script>

<main class="text-[13px] text-foreground">
	<div
		class="sticky top-0 z-10 flex flex-col justify-between border-b border-shelter-border bg-background/95 px-6 py-4 backdrop-blur-sm sm:flex-row sm:items-center"
	>
		<div class="flex items-center space-x-2">
			<a
				href={resolve('/back-office/shelters')}
				class="mr-1 rounded-lg p-2 transition hover:bg-muted/50"
			>
				<ArrowLeft class="h-4 w-4 text-muted-foreground" />
			</a>
			<h1 class="text-xl font-bold text-foreground">
				{isEdit ? `แก้ไขศูนย์: ${id}` : 'สร้างศูนย์พักพิงใหม่'}
			</h1>
		</div>
		<Button type="submit" form="shelter-form" disabled={$submitting || isPending}>
			<Save class="h-4 w-4" />
			<span>{isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลทั้งหมด'}</span>
		</Button>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-20 text-muted-foreground">
			กำลังโหลดข้อมูลศูนย์พักพิง...
		</div>
	{:else if isError}
		<div class="flex flex-col items-center justify-center space-y-2 py-20 text-destructive">
			<span>เกิดข้อผิดพลาดในการดึงข้อมูล</span>
			<span class="text-xs text-muted-foreground">{errorMessage}</span>
			<a href={resolve('/back-office/shelters')} class="text-muted-foreground underline"
				>กลับหน้ารวม</a
			>
		</div>
	{:else}
		<form id="shelter-form" method="POST" use:enhance class="space-y-6 p-6">
			<BasicInfoSection {form} {formData} />

			<CapacitySection {form} {formData} />

			<ZonesFacilitiesSection {form} {formData} shelterCode={id} />

			<UtilitiesSection {form} {formData} />

			<RiskSection {form} {formData} />
		</form>
	{/if}
</main>
