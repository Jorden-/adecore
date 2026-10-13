import { AccentSwatches } from '@adecore/ui';
import { useChatHost } from '../host';

/* The colors an account may wear, the host's palette. */
export function AccountColors({ value, label, onChange }: { value: string | undefined; label: string; onChange(id: string): void }) {
    const { all, featured, label: labelOf } = useChatHost().accents;
    return <AccentSwatches value={value} label={label} accents={all} featured={featured} labelOf={labelOf} onValueChange={onChange} />;
}
