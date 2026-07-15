<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Household } from '../domain/people';

	let {
		show,
		household,
		municipalityZoneItems = [],
		communityItems = [],
		onClose,
		onSave
	}: {
		show: boolean;
		household: Household;
		municipalityZoneItems: { value: string; label: string }[];
		communityItems: { value: string; label: string }[];
		onClose: () => void;
		onSave: (data: {
			label: string;
			notes: string;
			municipalityZone: string;
			community: string;
		}) => Promise<void>;
	} = $props();

	let label = $state(untrack(() => household.label));
	let notes = $state(untrack(() => household.notes ?? ''));
	let municipalityZone = $state(untrack(() => household.municipality_zone ?? ''));
	let community = $state(untrack(() => household.community ?? ''));
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-lg animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					แก้ไขข้อมูลทั่วไปครัวเรือน (Basic Info)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="space-y-4">
				<div class="space-y-1.5">
					<Label for="household_label"
						>ชื่อเรียกครัวเรือน <span class="text-destructive">*</span></Label
					>
					<Input id="household_label" bind:value={label} placeholder="เช่น ครอบครัวใจดี" />
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<Label for="basic_zone">เขตเทศบาล (Zone)</Label>
						<select
							id="basic_zone"
							bind:value={municipalityZone}
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							<option value="">-- ไม่ระบุ --</option>
							{#each municipalityZoneItems as mz (mz.value)}
								<option value={mz.value}>{mz.label}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-1.5">
						<Label for="basic_comm">ชุมชนในศูนย์ (Community)</Label>
						<select
							id="basic_comm"
							bind:value={community}
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							<option value="">-- ไม่ระบุ --</option>
							{#each communityItems as c (c.value)}
								<option value={c.value}>{c.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="household_notes">หมายเหตุเพิ่มเติม</Label>
					<Textarea
						id="household_notes"
						bind:value={notes}
						placeholder="ระบุรายละเอียดเพิ่มเติม..."
						rows={3}
					/>
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button
					disabled={!label.trim()}
					onclick={() =>
						onSave({
							label,
							notes,
							municipalityZone,
							community
						})}
				>
					บันทึกข้อมูล
				</Button>
			</div>
		</div>
	</div>
{/if}
