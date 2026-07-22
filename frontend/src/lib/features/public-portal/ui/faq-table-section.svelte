<script lang="ts">
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { z } from 'zod';
	import type { publicConfigBodySchema, FaqItem } from '../domain/config';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import Plus from '@lucide/svelte/icons/plus';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import FaqDialog from './faq-dialog.svelte';

	type ConfigBody = z.infer<typeof publicConfigBodySchema>;

	let {
		formData,
		activeType = 'public',
		submit
	}: {
		formData: SuperFormData<ConfigBody>;
		activeType?: string;
		submit?: () => void;
	} = $props();

	// Search state
	let search = $state('');

	// Modal State
	let modalOpen = $state(false);
	let editingIndex = $state<number | null>(null);
	let editingItem = $state<FaqItem>({ id: '', question: '', answer: '', is_published: true, order: 0 });

	function openAdd() {
		editingIndex = null;
		editingItem = {
			id: crypto.randomUUID(),
			question: '',
			answer: '',
			is_published: true,
			order: $formData.faqs[activeType]?.length || 0
		};
		modalOpen = true;
	}

	function openEdit(index: number) {
		editingIndex = index;
		editingItem = { ...$formData.faqs[activeType][index] };
		modalOpen = true;
	}

	function handleDelete(index: number) {
		if (!confirm('ยืนยันการลบคำถามนี้?')) return;
		$formData.faqs[activeType] = $formData.faqs[activeType].filter((_: FaqItem, i: number) => i !== index);
		setTimeout(() => submit?.(), 0);
	}

	const filteredFaqs = $derived(
		($formData.faqs[activeType] || [])
			.map((item: FaqItem, index: number) => ({ item, index }))
			.filter((x: { item: FaqItem; index: number }) => 
				search.trim() ? x.item.question.toLowerCase().includes(search.trim().toLowerCase()) : true
			)
			.sort((a: { item: FaqItem; index: number }, b: { item: FaqItem; index: number }) => a.item.order - b.item.order)
	);

	// --- Drag & Drop logic ---
	let draggedIndex = $state<number | null>(null);

	function onDragStart(e: DragEvent, realIndex: number) {
		if (search.trim()) {
			e.preventDefault();
			return;
		}
		draggedIndex = realIndex;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', realIndex.toString());
		}
	}

	function onDragOver(e: DragEvent) {
		if (search.trim()) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}

	function onDrop(e: DragEvent, dropRealIndex: number) {
		e.preventDefault();
		if (search.trim() || draggedIndex === null || draggedIndex === dropRealIndex) {
			draggedIndex = null;
			return;
		}

		const newArray = [...$formData.faqs[activeType]];
		const itemToMove = newArray[draggedIndex];
		newArray.splice(draggedIndex, 1);
		newArray.splice(dropRealIndex, 0, itemToMove);

		// Reassign order
		newArray.forEach((item, i) => {
			item.order = i;
		});

		$formData.faqs[activeType] = newArray;
		draggedIndex = null;
		setTimeout(() => submit?.(), 0);
	}
</script>

<section class="rounded-xl p-4 text-card-foreground shadow-sm sm:p-6" aria-label="รายการข้อมูล FAQ">
	<header class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-xl font-semibold">รายการข้อมูล ({$formData.faqs[activeType]?.length || 0})</h1>
		<div class="flex items-center gap-2">
			<div class="relative w-full sm:w-64">
				<Input bind:value={search} type="search" placeholder="ค้นหาคำถาม..." class="pl-9" aria-label="ค้นหา" />
				<svg class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			</div>
			<Button type="button" onclick={openAdd} class="shrink-0">
				<Plus class="mr-1 h-4 w-4" /> เพิ่มข้อมูล
			</Button>
		</div>
	</header>

	<div class="overflow-hidden rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground">
				<tr>
					<th class="px-4 py-3 text-left font-semibold w-12" title="จับลากเพื่อเรียงลำดับใหม่"></th>
					<th class="px-4 py-3 text-left font-semibold">คำถาม</th>
					<th class="px-4 py-3 text-center font-semibold w-36">สถานะ</th>
					<th class="px-4 py-3 text-right font-semibold w-48">จัดการ</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredFaqs as { item, index } (item.id || index)}
					<tr class="border-t hover:bg-muted/30 transition-colors {draggedIndex === index ? 'opacity-50' : ''}" 
						draggable={!search.trim()}
						ondragstart={(e) => onDragStart(e, index)}
						ondragover={onDragOver}
						ondrop={(e) => onDrop(e, index)}>
						<td class="px-4 py-3">
							<div class="flex items-center text-muted-foreground/50 hover:text-foreground {search.trim() ? 'cursor-not-allowed opacity-30' : 'cursor-grab active:cursor-grabbing'}" title={search.trim() ? 'ปิดการค้นหาเพื่อเรียงลำดับ' : 'ลากเพื่อสลับลำดับ'}>
								<GripVertical class="h-5 w-5" />
							</div>
						</td>
						<td class="px-4 py-3 font-medium text-foreground">{item.question}</td>
						<td class="px-4 py-3 text-center">
							<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium {item.is_published ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}">
								{item.is_published ? 'เผยแพร่' : 'ซ่อน'}
							</span>
						</td>
						<td class="px-4 py-3 text-right">
							<div class="flex items-center justify-end gap-2">
								<Button type="button" variant="outline" size="sm" class="border-blue-200 text-blue-700 hover:bg-blue-50" onclick={() => openEdit(index)}>
									<svg class="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
									จัดการ
								</Button>
								<Button type="button" variant="outline" size="sm" class="border-red-200 text-red-700 hover:bg-red-50" onclick={() => handleDelete(index)}>
									<svg class="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									ลบ
								</Button>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground">
							{#if search.trim()}
								ไม่พบข้อมูลมาสเตอร์ที่ค้นหาตามเงื่อนไขนี้
							{:else}
								ยังไม่มีข้อมูล — กดปุ่ม "+ เพิ่มข้อมูล" เพื่อเริ่ม
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<FaqDialog 
	bind:open={modalOpen} 
	bind:editingItem 
	{editingIndex} 
	{formData}
	{activeType}
	{submit}
/>
