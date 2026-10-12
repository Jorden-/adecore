import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { Editor, EditorFindState } from '@adecore/editor';
import { compileFind, EMPTY_FIND_QUERY, type FindQuery } from './find-query.ts';

export function FindReplace({ editor, className, onClose }: { editor: Editor; className?: string; onClose?(): void }) {
    const { t } = useTranslation('editor');
    const [query, setQuery] = useState<FindQuery>(EMPTY_FIND_QUERY);
    const [replacement, setReplacement] = useState('');
    const [preserveCase, setPreserveCase] = useState(false);
    const [state, setState] = useState<EditorFindState>({ count: 0, current: null });
    const compiled = useMemo(() => compileFind(query), [query]);
    useEffect(() => editor.onFind(setState), [editor]);
    useEffect(() => {
        editor.find(compiled.kind === 'pattern' ? query : null);
    }, [editor, query, compiled]);
    useEffect(() => {
        editor.setReplacePreview(compiled.kind === 'pattern' ? replacement : null, { preserveCase });
    }, [editor, compiled, replacement, preserveCase]);
    useEffect(
        () => () => {
            editor.endFind();
            editor.setReplacePreview(null);
        },
        [editor]
    );
    const failure = state.failed ?? state.captureFailed;
    const label =
        compiled.kind === 'invalid'
            ? t('find.invalid')
            : state.replaceFailed !== undefined
              ? t(`find.replace.failed.${state.replaceFailed}`, { edits: formatNumber(10000), characters: formatNumber(4000000) })
              : failure !== undefined
                ? t(`find.failed.${failure}`)
                : state.searching
                  ? t('find.searching')
                  : state.large
                    ? t('find.large')
                    : state.noSelection
                      ? t('find.noSelection')
                      : state.replaced !== undefined
                        ? t('find.replaced', { count: formatNumber(state.replaced) })
                        : state.limited && state.current === null
                          ? t('find.countMore', { total: formatNumber(state.count) })
                          : t(state.limited ? 'find.countLimited' : 'find.count', {
                                total: formatNumber(state.count),
                                current: state.current === null ? '0' : formatNumber(state.current + 1)
                            });
    return (
        <div className={`adecore-editor-find ${className ?? ''}`} role="search" aria-label={t('find.label')}>
            <div className="adecore-editor-find-row">
                <input
                    type="text"
                    aria-label={t('find.label')}
                    value={query.text}
                    onChange={(event) => setQuery({ ...query, text: event.target.value })}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) {
                            return;
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            editor.findStep(event.shiftKey ? -1 : 1);
                        }
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            editor.endFind();
                            editor.setReplacePreview(null);
                            onClose?.();
                            editor.focus();
                        }
                    }}
                />
                <output aria-live="polite">{label}</output>
                <Button size="xs" onClick={() => editor.findStep(-1)}>
                    {t('find.previous')}
                </Button>
                <Button size="xs" onClick={() => editor.findStep(1)}>
                    {t('find.next')}
                </Button>
            </div>
            <div className="adecore-editor-find-row">
                {(['caseSensitive', 'wholeWord', 'regex', 'inSelection'] as const).map((option) => (
                    <label key={option}>
                        <input type="checkbox" checked={query[option] === true} onChange={(event) => setQuery({ ...query, [option]: event.target.checked })} />
                        {t(`find.${option}`)}
                    </label>
                ))}
            </div>
            <div className="adecore-editor-find-row">
                <input type="text" aria-label={t('find.replace.label')} value={replacement} onChange={(event) => setReplacement(event.target.value)} />
                <label>
                    <input type="checkbox" checked={preserveCase} onChange={(event) => setPreserveCase(event.target.checked)} />
                    {t('find.replace.preserveCase')}
                </label>
                <Button size="xs" disabled={state.searching === true} onClick={() => editor.replace(replacement, { preserveCase })}>
                    {t('find.replace.one')}
                </Button>
                <Button size="xs" disabled={state.searching === true} onClick={() => void editor.replaceAllAsync(replacement, { preserveCase })}>
                    {t('find.replace.allLabel')}
                </Button>
            </div>
        </div>
    );
}
