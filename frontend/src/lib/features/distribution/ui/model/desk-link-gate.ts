import type { DeskMode } from './desk-mode';

/**
 * FR-DFS-05 for links: a link that changes the desk mode unmounts the step's form, so while a
 * draft exists it waits on the same confirm as the in-page mode switcher. Same-mode links and
 * links with no draft apply at once.
 */
export function incomingLinkAction(input: {
	currentMode: DeskMode;
	linkMode: DeskMode;
	hasDraft: boolean;
}): 'apply' | 'confirm' {
	return input.linkMode !== input.currentMode && input.hasDraft ? 'confirm' : 'apply';
}
