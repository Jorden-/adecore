import type { Ref } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import { IconButton, type IconButtonSize } from './IconButton.tsx';
import type { Shortcut } from './shortcut.ts';

export type CloseButtonProps = {
    label: string;
    kbd?: Shortcut | string;
    size?: IconButtonSize;
    className?: string;
    ref?: Ref<HTMLButtonElement>;
} & ({ onClick: () => void } | { dialog: true });

/* The close button in the header of every panel and dialog. In a dialog it is that dialog's own close part. */
export function CloseButton({ label, kbd, size, className, ref, ...closes }: CloseButtonProps) {
    if ('dialog' in closes) {
        return <IconButton ref={ref} icon={X} label={label} kbd={kbd} size={size} className={className} render={<Dialog.Close />} />;
    }
    return <IconButton ref={ref} icon={X} label={label} kbd={kbd} size={size} className={className} onClick={closes.onClick} />;
}
