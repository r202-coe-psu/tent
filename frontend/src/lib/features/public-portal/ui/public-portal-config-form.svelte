<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { publicConfigBodySchema } from '../domain/config';
	import { Button } from '$lib/components/ui/button';
	import Save from '@lucide/svelte/icons/save';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import SocialSection from './social-section.svelte';
	import FaqTableSection from './faq-table-section.svelte';

	let { data, activeType = 'public' } = $props();

	const form = superForm(data.form, {
		validators: zod4(publicConfigBodySchema),
		dataType: 'json',
		onUpdated: async ({ form }) => {
			if (form.valid) {
				toast.success(form.message || 'บันทึกสำเร็จ');
				await invalidateAll();
			} else {
				toast.error(form.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
			}
		}
	});

	const { form: formData, enhance, submitting, submit } = form;
</script>

<form method="POST" use:enhance>
	{#if activeType === 'social'}
		<SocialSection {form} {formData} />
	{:else}
		<FaqTableSection {formData} {activeType} {submit} />
	{/if}

	<!-- Sticky Bottom Action Bar -->
	<div class="fixed right-0 bottom-0 left-0 border-t border-border/50 bg-background/80 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] backdrop-blur-md md:left-72 z-10">
		<div class="mx-auto flex max-w-7xl items-center justify-end space-x-4 pr-4">
			<Button type="button" variant="ghost" class="font-medium" onclick={() => { /* maybe reset form */ }}>ยกเลิก</Button>
			<Button type="submit" disabled={$submitting} class="min-w-[140px] shadow-md transition-all hover:shadow-lg">
				{#if $submitting}
					<div class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"></div>
					กำลังบันทึก...
				{:else}
					<Save class="mr-2 h-4 w-4" /> บันทึกการเปลี่ยนแปลง
				{/if}
			</Button>
		</div>
	</div>
</form>
