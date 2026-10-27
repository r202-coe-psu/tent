import type { Attachment } from 'svelte/attachments';
import { EDIT_REJECTION_MESSAGE, keyRejection, textRejection } from '../domain/count-input';
import type { EditRejection } from '../domain/count-input';

/**
 * Keeps a negative or non-numeric value out of `<input type="number">` boxes. `min="0"` does not,
 * since the browser accepts typed, pasted and autofilled negatives and only flags them on submit.
 * One guard per component. `attach(id)` guards a box, `messages[id]` is the inline note under it
 * and clears on the next edit the box accepts.
 */
export class CountInputGuard {
	messages = $state<Record<string, string>>({});

	attach(id: string): Attachment<HTMLInputElement> {
		return (input) => {
			let clamping = false;
			const reject = (reason: EditRejection) => {
				this.messages[id] = EDIT_REJECTION_MESSAGE[reason];
			};

			const onKeydown = (e: KeyboardEvent) => {
				const reason = keyRejection(e);
				if (!reason) return;
				e.preventDefault();
				reject(reason);
			};
			const onPaste = (e: ClipboardEvent) => {
				const reason = textRejection(e.clipboardData?.getData('text') ?? '');
				if (!reason) return;
				e.preventDefault();
				reject(reason);
			};
			const onDrop = (e: DragEvent) => {
				const reason = textRejection(e.dataTransfer?.getData('text') ?? '');
				if (!reason) return;
				e.preventDefault();
				reject(reason);
			};
			const onInput = () => {
				if (clamping) return;
				if (textRejection(input.value) === 'negative') {
					clamping = true;
					input.value = '0';
					input.dispatchEvent(new Event('input', { bubbles: true }));
					clamping = false;
					reject('negative');
					return;
				}
				delete this.messages[id];
			};

			input.addEventListener('keydown', onKeydown);
			input.addEventListener('paste', onPaste);
			input.addEventListener('drop', onDrop);
			input.addEventListener('input', onInput);
			return () => {
				input.removeEventListener('keydown', onKeydown);
				input.removeEventListener('paste', onPaste);
				input.removeEventListener('drop', onDrop);
				input.removeEventListener('input', onInput);
				delete this.messages[id];
			};
		};
	}
}
