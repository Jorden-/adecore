import { useState } from 'react';
import { Combobox } from '@base-ui-components/react/combobox';
import clsx from 'clsx';
import { ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.tsx';
import { MENU_LABEL } from './menu/parts.tsx';
import { renderPositioner } from './popup-layer.ts';
import type { SelectProps } from './Select.tsx';
import { RowContent } from './select-row.tsx';
import { isGroup, rowClassName, TRIGGER_DISABLED, TRIGGER_SIZE, TRIGGER_VARIANT, type SelectGroup, type SelectItem } from './select-shared.ts';

/* The `Select` with a search field on top of its options, for lists too long to scan. A combobox of Base UI brings the filtering and the keyboard. */
export function SelectSearch<T extends string>({
    value,
    onValueChange,
    items,
    label,
    placeholder,
    searchPlaceholder,
    size = 'md',
    variant = 'outlined',
    disabled,
    align = 'start',
    truncateValue = true,
    className,
    ref
}: SelectProps<T>) {
    const { t } = useTranslation('ui');
    const [query, setQuery] = useState('');
    const groups = items.length > 0 && isGroup(items[0]!) ? (items as SelectGroup<T>[]) : null;
    const flat = groups ? groups.flatMap((group) => group.items) : (items as SelectItem<T>[]);
    const byValue = new Map(flat.map((item) => [item.value, item]));
    const selected = value === null ? null : (byValue.get(value) ?? null);
    const comboboxItems = groups ? groups.map((group) => ({ value: group.label, items: group.items.map((item) => item.value) })) : flat.map((item) => item.value);
    const searchLabel = searchPlaceholder ?? t('select.search');

    const renderRow = (itemValue: T) => {
        const item = byValue.get(itemValue)!;
        return (
            <Combobox.Item key={item.value} className={rowClassName(item)} value={item.value} disabled={item.disabled}>
                <RowContent item={item} picked={item.value === value} text={<span className="truncate">{item.label}</span>} />
            </Combobox.Item>
        );
    };

    return (
        <Combobox.Root<T>
            items={comboboxItems}
            value={value as T}
            disabled={disabled}
            autoHighlight
            itemToStringLabel={(itemValue) => byValue.get(itemValue)?.label ?? itemValue}
            onValueChange={(next) => {
                if (next !== null) {
                    onValueChange(next);
                }
            }}
            onInputValueChange={setQuery}
            onOpenChange={(open) => {
                if (!open) {
                    setQuery('');
                }
            }}
        >
            <Combobox.Trigger
                ref={ref}
                aria-label={label}
                className={clsx('flex shrink-0 items-center whitespace-nowrap text-xs', TRIGGER_SIZE[size], TRIGGER_VARIANT[variant], TRIGGER_DISABLED, className)}
            >
                {selected?.icon}
                <span className={clsx(truncateValue && 'truncate')}>{selected?.label ?? placeholder ?? t('action.select')}</span>
                <span className="ml-auto flex shrink-0 pl-1">
                    <Icon icon={ChevronDown} size={14} />
                </span>
            </Combobox.Trigger>
            <Combobox.Portal>
                <Combobox.Positioner className="popup-positioner" render={renderPositioner} side="bottom" align={align} sideOffset={6}>
                    <Combobox.Popup className="menu-popup flex max-h-96 flex-col">
                        <label className="flex shrink-0 items-center gap-2 border-b border-border px-3">
                            <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                            <Combobox.Input
                                aria-label={searchLabel}
                                placeholder={searchLabel}
                                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                            />
                        </label>
                        <Combobox.Empty className="px-3 py-4 text-center text-xs text-text-faint empty:hidden">{t('select.noMatch', { query })}</Combobox.Empty>
                        <Combobox.List className="min-h-0 overflow-auto">
                            {groups
                                ? (group: { value: string; items: T[] }) => (
                                      <Combobox.Group key={group.value} items={group.items}>
                                          <Combobox.GroupLabel className={MENU_LABEL}>{group.value}</Combobox.GroupLabel>
                                          <Combobox.Collection>{renderRow}</Combobox.Collection>
                                      </Combobox.Group>
                                  )
                                : renderRow}
                        </Combobox.List>
                    </Combobox.Popup>
                </Combobox.Positioner>
            </Combobox.Portal>
        </Combobox.Root>
    );
}
