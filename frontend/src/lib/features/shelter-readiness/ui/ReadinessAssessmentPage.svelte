<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		ReadinessItemStatus,
		ReadinessSectionId,
		ReadinessTier,
		ShelterReadinessAssessmentDoc
	} from '../domain/readiness.types';
	import { READINESS_SECTIONS, getReadinessCatalogByTier } from '../domain/readiness-catalog';
	import {
		buildInitialAnswersFromCatalog,
		createAssessmentDocPrefilledFromLatest,
		createNewAssessmentDoc,
		tallyAssessmentSummary
	} from '../domain/readiness.utils';
	import { getShelterReadinessRepository } from '../data/shelter-readiness.repository';
	import ReadinessHeaderCard from './ReadinessHeaderCard.svelte';
	import ReadinessStickyNav from './ReadinessStickyNav.svelte';
	import ReadinessQuestionItem from './ReadinessQuestionItem.svelte';
	import ReadinessVerdictCard from './ReadinessVerdictCard.svelte';
	import ReadinessHistoryTimeline from './ReadinessHistoryTimeline.svelte';
	import ResetTierConfirmModal from './ResetTierConfirmModal.svelte';
	import StartAssessmentDialog from './StartAssessmentDialog.svelte';
	import ReadinessStatusBadge from './ReadinessStatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CopyPlus from '@lucide/svelte/icons/copy-plus';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';

	interface Props {
		shelterCode: string;
		shelterName: string;
		initialAssessments?: ShelterReadinessAssessmentDoc[];
		currentUser: string;
	}

	let { shelterCode, shelterName, initialAssessments = [], currentUser }: Props = $props();

	const repo = getShelterReadinessRepository();

	let assessments = $state<ShelterReadinessAssessmentDoc[]>(initialAssessments);

	onMount(() => {
		refreshList();
	});

	// Default view is 'history' (หน้ารวมประวัติการประเมิน เหมือน Daily SOP)
	let view = $state<'history' | 'form'>('history');

	function getInitialDoc(): ShelterReadinessAssessmentDoc {
		if (initialAssessments.length > 0) {
			const latest = initialAssessments[0];
			if (latest.status === 'draft') return latest;
		}
		return createNewAssessmentDoc({
			shelterCode,
			tier: 'local_admin',
			header: {
				shelter_name: shelterName,
				operating_agency: '',
				max_capacity: 0,
				phone_contact: '',
				building_type: '',
				location_address: '',
				assessor_name: currentUser,
				assessed_date: new Date().toISOString().split('T')[0]
			},
			createdBy: currentUser
		});
	}

	// Active working document
	let currentDoc = $state<ShelterReadinessAssessmentDoc>(getInitialDoc());

	let savingDraft = $state(false);
	let submitting = $state(false);

	// Modals state
	let startModalOpen = $state(false);
	let resetModalOpen = $state(false);
	let pendingTier = $state<ReadinessTier | null>(null);

	const isReadOnly = $derived(currentDoc.status === 'submitted');
	const latestCompleted = $derived(assessments.find((d) => d.status === 'submitted') ?? null);

	// Auto-calculated summary
	const liveSummary = $derived(tallyAssessmentSummary(currentDoc.items));

	function handleTierChangeRequest(newTier: ReadinessTier) {
		if (newTier === currentDoc.tier) return;
		const hasAnswered = currentDoc.items.some((i) => i.status !== 'unassessed');
		if (hasAnswered) {
			pendingTier = newTier;
			resetModalOpen = true;
		} else {
			applyTierChange(newTier);
		}
	}

	function applyTierChange(newTier: ReadinessTier) {
		const newCatalog = getReadinessCatalogByTier(newTier);
		const newItems = buildInitialAnswersFromCatalog(newCatalog);
		currentDoc = {
			...currentDoc,
			tier: newTier,
			items: newItems,
			summary: tallyAssessmentSummary(newItems)
		};
	}

	function confirmResetTier() {
		if (pendingTier) {
			applyTierChange(pendingTier);
			pendingTier = null;
			toast.info('รีเซ็ตแบบประเมินตามระดับใหม่เรียบร้อยแล้ว');
		}
		resetModalOpen = false;
	}

	function updateItemStatus(index: number, newStatus: ReadinessItemStatus) {
		if (isReadOnly) return;
		const newItems = [...currentDoc.items];
		newItems[index] = { ...newItems[index], status: newStatus };
		currentDoc = {
			...currentDoc,
			items: newItems,
			summary: tallyAssessmentSummary(newItems)
		};
	}

	function updateItemNote(index: number, newNote: string) {
		if (isReadOnly) return;
		const newItems = [...currentDoc.items];
		newItems[index] = { ...newItems[index], note: newNote };
		currentDoc = {
			...currentDoc,
			items: newItems
		};
	}

	function scrollToSection(sectionId: ReadinessSectionId) {
		const el = document.getElementById(`section-${sectionId}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	async function handleSaveDraft() {
		if (isReadOnly) return;
		savingDraft = true;
		try {
			const res = await repo.saveDraft(currentDoc);
			currentDoc = res;
			toast.success('บันทึกแบบร่างเรียบร้อยแล้ว');
			await refreshList();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`ไม่สามารถบันทึกแบบร่างได้: ${msg}`);
		} finally {
			savingDraft = false;
		}
	}

	async function handleSubmitVerdict() {
		if (!currentDoc.verdict) {
			toast.error('กรุณาเลือกผลการตัดสินความพร้อม (Verdict)');
			return;
		}
		if (!currentDoc.justification_note.trim()) {
			toast.error('กรุณาระบุเหตุผลหรือมาตรการชดเชย');
			return;
		}

		submitting = true;
		try {
			const res = await repo.submitVerdict({
				doc: currentDoc,
				verdict: currentDoc.verdict,
				justificationNote: currentDoc.justification_note,
				submittedBy: currentUser
			});
			currentDoc = res;
			toast.success('ยืนยันและบันทึกผลการประเมินความพร้อมสำเร็จ');
			await refreshList();
			view = 'history';
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาด: ${msg}`);
		} finally {
			submitting = false;
		}
	}

	async function refreshList() {
		try {
			assessments = await repo.listAssessments(shelterCode);
		} catch (e) {
			console.error('Failed to reload assessments list:', e);
		}
	}

	function handleStartNew(tier: ReadinessTier) {
		currentDoc = createNewAssessmentDoc({
			shelterCode,
			tier,
			header: {
				shelter_name: shelterName,
				operating_agency: currentDoc.header.operating_agency,
				max_capacity: currentDoc.header.max_capacity,
				phone_contact: currentDoc.header.phone_contact,
				building_type: currentDoc.header.building_type,
				location_address: currentDoc.header.location_address,
				assessor_name: currentUser,
				assessed_date: new Date().toISOString().split('T')[0]
			},
			createdBy: currentUser
		});
		view = 'form';
		toast.info(
			`เปิดแบบประเมินฉบับใหม่ (${tier === 'community' ? 'ระดับชุมชน' : tier === 'local_admin' ? 'ระดับ อปท.' : 'ระดับเมือง'})`
		);
	}

	function handleStartPrefilled(latest: ShelterReadinessAssessmentDoc) {
		currentDoc = createAssessmentDocPrefilledFromLatest({
			latestDoc: latest,
			createdBy: currentUser
		});
		view = 'form';
		toast.info(
			'คัดลอกผลจากรอบล่าสุดมาตั้งต้นเรียบร้อยแล้ว คุณสามารถตรวจปรับปรุงเฉพาะข้อที่เปลี่ยนได้'
		);
	}

	function handleSelectAssessment(doc: ShelterReadinessAssessmentDoc) {
		currentDoc = doc;
		view = 'form';
	}
</script>

<div class="relative w-full space-y-5 pb-16">
	{#if view === 'history'}
		<!-- View 1: หน้ารวมประวัติการประเมินความพร้อม (History Overview) -->
		<ReadinessHistoryTimeline
			{shelterName}
			{shelterCode}
			{assessments}
			onOpenStartModal={() => (startModalOpen = true)}
			onSelectAssessment={handleSelectAssessment}
		/>
	{:else}
		<!-- View 2: หน้าทำแบบประเมิน (Assessment Form View) -->
		<div
			class="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs sm:p-5 lg:flex-row lg:items-center lg:justify-between"
		>
			<div class="min-w-0 space-y-1.5">
				<div class="flex flex-wrap items-center gap-2.5">
					<Button
						variant="ghost"
						size="sm"
						onclick={() => (view = 'history')}
						class="-ml-2 h-8 cursor-pointer gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
					>
						<ArrowLeft class="size-4" />
						<span>กลับหน้ารวมประวัติ</span>
					</Button>
					<span class="text-slate-300">|</span>
					<h2 class="text-base leading-tight font-bold text-slate-900 sm:text-lg">
						แบบประเมินความพร้อมศูนย์พักพิงอัจฉริยะ
					</h2>
					<ReadinessStatusBadge verdict={currentDoc.verdict} status={currentDoc.status} size="sm" />
				</div>
				<p class="pl-0 text-xs text-slate-500 sm:pl-1">
					ศูนย์พักพิง: <strong class="text-slate-800">{shelterName}</strong>
					<span class="text-slate-400">({shelterCode})</span>
				</p>
			</div>

			<!-- Form Actions -->
			<div class="flex shrink-0 flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => (startModalOpen = true)}
					class="h-9 gap-1.5 border-sky-300 bg-sky-50 text-xs font-bold text-sky-900 hover:bg-sky-100"
				>
					<PlusCircle class="size-3.5" />
					<span>เริ่มรอบใหม่</span>
				</Button>
			</div>
		</div>

		{#if isReadOnly}
			<div
				class="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900"
			>
				<div class="flex items-center gap-2">
					<span class="font-bold">🔒 คุณกำลังดูผลการตรวจรอบที่เสร็จสมบูรณ์แล้ว (Read-Only)</span>
					<span
						>• ตรวจเมื่อ {currentDoc.submitted_at ?? currentDoc.created_at} โดย {currentDoc.submitted_by}</span
					>
				</div>
				<Button
					size="sm"
					variant="outline"
					onclick={() => handleStartPrefilled(currentDoc)}
					class="h-7 gap-1.5 border-blue-300 bg-white text-xs font-semibold hover:bg-blue-100"
				>
					<CopyPlus class="size-3" />
					เปิดรอบใหม่โดยใช้ผลนี้
				</Button>
			</div>
		{/if}

		<!-- Sticky Nav Bar -->
		<ReadinessStickyNav
			summary={liveSummary}
			{savingDraft}
			readOnly={isReadOnly}
			onSaveDraft={handleSaveDraft}
			onScrollToSection={scrollToSection}
		/>

		<!-- Header Details Card -->
		<ReadinessHeaderCard
			bind:header={currentDoc.header}
			tier={currentDoc.tier}
			readOnly={isReadOnly}
			onTierChangeRequest={handleTierChangeRequest}
		/>

		<!-- Checklist Sections -->
		<div class="space-y-8 pt-2">
			{#each READINESS_SECTIONS as section (section.id)}
				{@const sectionItems = currentDoc.items.filter((i) => i.section_id === section.id)}
				<div id={`section-${section.id}`} class="scroll-mt-36 space-y-3">
					<div class="flex items-center justify-between border-b border-slate-200 pb-2">
						<h3 class="text-base font-bold text-slate-900">
							{section.label}
						</h3>
						<span class="text-xs font-semibold text-slate-500 tabular-nums">
							{sectionItems.filter((i) => i.status !== 'unassessed').length} / {sectionItems.length} ข้อ
						</span>
					</div>

					<div class="grid grid-cols-1 gap-3">
						{#each currentDoc.items as item, idx (item.question_id)}
							{#if item.section_id === section.id}
								<ReadinessQuestionItem
									index={idx + 1}
									{item}
									readOnly={isReadOnly}
									onChangeStatus={(s) => updateItemStatus(idx, s)}
									onChangeNote={(n) => updateItemNote(idx, n)}
								/>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<!-- Final Verdict and Submission Card -->
		<div class="pt-6">
			<ReadinessVerdictCard
				summary={liveSummary}
				selectedVerdict={currentDoc.verdict}
				bind:justificationNote={currentDoc.justification_note}
				{submitting}
				readOnly={isReadOnly}
				onSelectVerdict={(v) => (currentDoc = { ...currentDoc, verdict: v })}
				onChangeNote={(n) => (currentDoc = { ...currentDoc, justification_note: n })}
				onSubmitVerdict={handleSubmitVerdict}
			/>
		</div>
	{/if}

	<!-- Modal 1: เลือกรูปแบบการเริ่มแบบประเมินใหม่ -->
	<StartAssessmentDialog
		bind:open={startModalOpen}
		latestAssessment={latestCompleted ?? (assessments.length > 0 ? assessments[0] : null)}
		onStartNew={handleStartNew}
		onStartPrefilled={handleStartPrefilled}
		onCancel={() => (startModalOpen = false)}
	/>

	<!-- Modal 2: ยืนยันการรีเซ็ตคำตอบเมื่อเปลี่ยน Tier กลางคัน -->
	<ResetTierConfirmModal
		bind:open={resetModalOpen}
		targetTierLabel={pendingTier === 'community'
			? 'ระดับชุมชน'
			: pendingTier === 'local_admin'
				? 'ระดับ อปท.'
				: 'ระดับเมือง'}
		onConfirm={confirmResetTier}
		onCancel={() => {
			pendingTier = null;
			resetModalOpen = false;
		}}
	/>
</div>
