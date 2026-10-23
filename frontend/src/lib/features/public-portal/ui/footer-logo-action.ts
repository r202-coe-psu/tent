import type { ActionResult } from '@sveltejs/kit';

type Toaster = { success: (message: string) => unknown; error: (message: string) => unknown };

/** Toast a footer-logo action result; `true` when it succeeded. */
export function logoActionResult(result: ActionResult, toast: Toaster): boolean {
	if (result.type === 'success') {
		toast.success(String(result.data?.logoMessage ?? 'บันทึกเรียบร้อยแล้ว'));
		return true;
	}
	if (result.type === 'failure') {
		toast.error(String(result.data?.logoError ?? 'เกิดข้อผิดพลาดในการบันทึกโลโก้'));
		return false;
	}
	if (result.type === 'error') toast.error('เกิดข้อผิดพลาดในการบันทึกโลโก้');
	return false;
}
