<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
</script>

<div
	class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400"
>
	<ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
	<div class="space-y-1">
		<h4 class="text-sm leading-none font-semibold">
			นโยบายความเป็นส่วนตัวของข้อมูลทางการแพทย์ (NFR-5 / FR-48)
		</h4>
		<p class="text-xs leading-normal text-amber-700 dark:text-amber-400/80">
			ข้อมูลทางการแพทย์และข้อมูลระบุตัวตน (PII) จะถูกเซ็นเซอร์ (Redact)
			โดยอัตโนมัติสำหรับผู้ใช้ภายนอกโรงพยาบาล
			ยกเว้นทีมแพทย์ในหน่วยงานต้นทางและปลายทางเท่านั้นที่มีสิทธิ์ดูรายละเอียดเต็ม
		</p>
	</div>
</div>
