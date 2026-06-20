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
		ShelterDetailsSection,
		ZonesSection,
		ItemsSection,
		RulesSection,
		SopsSection,
		createShelterSchema,
		updateShelterSchema,
		type Zone,
		type Item,
		type Rule,
		type Sop
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

	let code = $state('');
	let name = $state('');
	let capacity = $state<number>(0);
	let zones = $state<Zone[]>([]);
	let items = $state<Item[]>([]);
	let rules = $state<Rule[]>([]);
	let sops = $state<Sop[]>([]);

	const schema = () => isEdit ? updateShelterSchema : createShelterSchema;
	const form = superForm(defaults(zod4(schema())), {
		SPA: true,
		validators: zod4(schema()),
		resetForm: false,
		onSubmit: async () => {
			form.form.set({
				code,
				name,
				capacity: Number(capacity),
				zones: $state.snapshot(zones),
				items: $state.snapshot(items),
				rules: $state.snapshot(rules),
				sops: $state.snapshot(sops)
			});
		},
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				console.error('[ShelterForm] Validation failed:', validated.errors);
				toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
				return;
			}

			const payload = {
				name: validated.data.name.trim(),
				capacity: validated.data.capacity,
				zones: validated.data.zones,
				items: validated.data.items,
				rules: validated.data.rules,
				sops: validated.data.sops
			};

			if (isEdit) {
				updateMutation.mutate(
					{ code: id, input: payload },
					{
						onSuccess: () => {
							toast.success('อัปเดตข้อมูลโครงสร้างศูนย์พักพิงสำเร็จ');
							goto(resolve('/back-office/shelters'));
						},
						onError: (err) => {
							toast.error(err.message || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
						}
					}
				);
			} else {
				createMutation.mutate(
					{
						code: validated.data.code.trim(),
						...payload
					},
					{
						onSuccess: () => {
							toast.success('บันทึกข้อมูลและสร้างศูนย์พักพิงสำเร็จ');
							goto(resolve('/back-office/shelters'));
						},
						onError: (err) => {
							toast.error(err.message || 'เกิดข้อผิดพลาดในการสร้างศูนย์พักพิง');
						}
					}
				);
			}
		}
	});

	const { enhance, submitting } = form;

	// Populate form data when edit query loads
	$effect(() => {
		if (shelterQuery.data) {
			code = shelterQuery.data.code;
			name = shelterQuery.data.name;
			capacity = shelterQuery.data.capacity;
			zones = $state.snapshot(shelterQuery.data.zones ?? []);
			items = $state.snapshot(shelterQuery.data.items ?? []);
			rules = $state.snapshot(shelterQuery.data.rules ?? []);
			sops = $state.snapshot(shelterQuery.data.sops ?? []);
		}
	});

	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	const isLoading = $derived(isEdit ? shelterQuery.isLoading : false);
	const isError = $derived(isEdit ? shelterQuery.isError : false);
	const errorMessage = $derived(isEdit ? (shelterQuery.error?.message ?? '') : '');
</script>

<main class="flex-1 space-y-6 overflow-y-auto p-6 text-[13px] text-foreground">
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
		<div
			class="top-0 z-10 -mx-6 -mt-6 mb-2 flex flex-col justify-between border-b border-shelter-border bg-background/95 px-6 py-4 backdrop-blur-sm sm:flex-row sm:items-center"
		>
			<div class="flex items-center space-x-2">
				<a
					href={resolve('/back-office/shelters')}
					class="mr-1 rounded-lg p-2 transition hover:bg-muted/50"
				>
					<ArrowLeft class="h-4 w-4 text-muted-foreground" />
				</a>
				<h1 class="text-xl font-bold text-foreground">
					ตั้งค่าโครงสร้างระบบ ({isEdit ? `แก้ไขศูนย์: ${id}` : 'สร้างศูนย์พักพิงใหม่'})
				</h1>
			</div>
			<Button type="submit" form="shelter-form" disabled={$submitting || isPending}>
				<Save class="h-4 w-4" />
				<span>{isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลโครงสร้างทั้งหมด'}</span>
			</Button>
		</div>

		<form id="shelter-form" method="POST" use:enhance>
			<ShelterDetailsSection bind:code bind:name bind:capacity disabledCode={isEdit} />

			<ZonesSection bind:zones />

			<ItemsSection bind:items />

			<RulesSection bind:rules />

			<SopsSection bind:sops />
		</form>
	{/if}
</main>
