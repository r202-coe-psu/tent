import type { Attachment } from 'svelte/attachments';

/** Free a `blob:` URL once the element showing it leaves the page. */
export function revokeObjectUrlOnRemove(url: string): Attachment {
	return () => () => {
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
	};
}
