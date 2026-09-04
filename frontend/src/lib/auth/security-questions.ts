/**
 * Canonical Security Questions Catalog.
 * Shared by both client (forms/options) and server (validation/labels).
 */

export interface SecurityQuestion {
	id: string;
	label: string;
}

export const SECURITY_QUESTIONS: readonly SecurityQuestion[] = [
	{ id: 'high_school', label: 'โรงเรียนมัธยมที่คุณเคยศึกษาคือที่ใด?' },
	{ id: 'birth_province', label: 'จังหวัดที่คุณเกิดคือจังหวัดใด?' },
	{ id: 'first_pet', label: 'สัตว์เลี้ยงตัวแรกของคุณชื่ออะไร?' },
	{ id: 'primary_school', label: 'โรงเรียนประถมที่คุณเคยศึกษาคือที่ใด?' },
	{ id: 'favorite_teacher', label: 'คุณครูที่คุณประทับใจมากที่สุดชื่ออะไร?' },
	{ id: 'first_workplace', label: 'สถานที่ทำงานหรือบริษัทแห่งแรกของคุณคือที่ใด?' }
] as const;

export const SECURITY_QUESTION_IDS = SECURITY_QUESTIONS.map((q) => q.id) as [string, ...string[]];

export function getSecurityQuestionLabel(questionId: string): string | null {
	const found = SECURITY_QUESTIONS.find((q) => q.id === questionId);
	return found ? found.label : null;
}
