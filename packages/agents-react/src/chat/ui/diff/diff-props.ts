import type { ChatFileChange } from '@adecore/agent-contracts';
import type { DiffContents } from '../full-diff';

export interface UnifiedDiffProps {
    allowEditor?: boolean;
    maxHeight?: number;
    ignoreWhitespace?: boolean;
    change: ChatFileChange;
    overflow?: 'wrap' | 'scroll';
    /* `split` puts the old and the new side by side; the chat always stacks. */
    diffStyle?: 'unified' | 'split';
    /* Grow to the height of a flex column around it. */
    fill?: boolean;
    /* Both whole texts the patch was made between, with which a person can unfold the lines between hunks. */
    contents?: DiffContents;
}
