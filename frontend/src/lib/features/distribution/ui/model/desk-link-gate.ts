import type { DeskMode } from './desk-mode';

/**
 * FR-DFS-05 for navigations: one that changes the desk mode unmounts the step's form, so while a
 * draft exists it is cancelled (`beforeNavigate`) and waits on the same confirm as the in-page
 * mode switcher. Same-mode navigations and those with no draft proceed at once.
 */
export function incomingLinkAction(input: {
	currentMode: DeskMode;
	linkMode: DeskMode;
	hasDraft: boolean;
}): 'apply' | 'confirm' {
	return input.linkMode !== input.currentMode && input.hasDraft ? 'confirm' : 'apply';
}
