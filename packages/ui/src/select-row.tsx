import type { ReactNode } from 'react';
import { MenuCheck } from './menu/parts.tsx';
import type { SelectItem } from './select-shared.ts';

/* The check, icon and text of a row; `text` is the element that carries the label, which Base UI wants to know. */
export function RowContent<T extends string>({ item, picked, text }: { item: SelectItem<T>; picked: boolean; text: ReactNode }) {
    return (
        <>
            <MenuCheck kind="radio" checked={picked} />
            {item.icon && <span className="flex h-lh shrink-0 items-center">{item.icon}</span>}
            <span className="flex min-w-0 flex-col">
                {text}
                {item.description && <span className="text-xs text-text-faint">{item.description}</span>}
            </span>
        </>
    );
}
