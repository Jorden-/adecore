import { useTranslation } from 'react-i18next';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import { fileUriToPath, type Location } from '@adecore/lsp';
import { Button, Icon, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { EditorPosition } from '@adecore/editor';
import { basenameOf } from './paths.ts';
import type { EditorLanguage } from './editor-language.ts';
import { codeLabelOf, severityOf, type Problem } from './diagnostics-model.ts';
import type { HoverInfo } from './popups.ts';
import { SymbolSections } from './HoverSections.tsx';

const SEVERITY_ICONS = { error: CircleX, warning: TriangleAlert, info: Info, hint: Info } as const;
const SEVERITY_COLORS = { error: 'text-status-error', warning: 'text-status-needs-you', info: 'text-status-running', hint: 'text-text-muted' } as const;

/*
 * Where a definition is: only its line in the file of the card, else the file and the line, with a long name cut
 * short before the line. A definition outside the project folder, such as the stubs of a standard library, has none.
 */
export function DefinitionPlace({ definition, uri, folder }: { definition: Location; uri: string; folder: string }) {
    const { t } = useTranslation('editor');
    const path = fileUriToPath(definition.uri);
    const line = formatNumber(definition.range.start.line + 1);
    if (path === null || (folder !== '' && !path.startsWith(`${folder}/`))) {
        return null;
    }
    if (definition.uri === uri) {
        return <span className="text-text-faint">{t('language.hover.line', { line })}</span>;
    }
    return (
        <span className="flex min-w-0 font-mono text-text-faint">
            <span className="truncate">{basenameOf(path)}</span>
            <span className="shrink-0">:{line}</span>
        </span>
    );
}

function ProblemSection({ problem, language }: { problem: Problem; language: EditorLanguage }) {
    const { t } = useTranslation('editor');
    const { diagnostic } = problem;
    const severity = severityOf(diagnostic);
    const label =
        diagnostic.source === undefined ? [codeLabelOf(diagnostic), problem.server].filter((part) => part !== '').join(' · ') : codeLabelOf(diagnostic);
    const supported = language.codeActions.supported;
    return (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex items-start gap-2">
                <Icon icon={SEVERITY_ICONS[severity]} size={14} className={`mt-px shrink-0 ${SEVERITY_COLORS[severity]}`} />
                <div className="min-w-0 text-xs/[18px] break-words whitespace-pre-wrap select-text">{diagnostic.message}</div>
            </div>
            {label !== '' && <div className="pl-[22px] text-xs text-text-muted select-text">{label}</div>}
            {diagnostic.relatedInformation?.map((related, index) => {
                const path = fileUriToPath(related.location.uri);
                return (
                    <div key={index} className="pl-[22px] text-xs text-text-muted">
                        {path !== null && (
                            <button type="button" className="font-mono text-accent hover:underline" onClick={() => language.goTo(related.location)}>
                                {basenameOf(path)}:{formatNumber(related.location.range.start.line + 1)}
                            </button>
                        )}{' '}
                        {related.message}
                    </div>
                );
            })}
            <div className="pt-1 pl-[22px]">
                <Tooltip label={t(supported ? 'language.hover.quickFix' : 'language.hover.quickFixNone')}>
                    <Button
                        size="xs"
                        variant="secondary"
                        aria-disabled={!supported}
                        onClick={() => {
                            if (supported) {
                                language.hover.hide();
                                void language.codeActions.quickFixFor(problem);
                            }
                        }}
                    >
                        {t('language.hover.quickFix')}
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}

export function HoverCard({
    language,
    problems,
    info,
    anchor,
    position
}: {
    language: EditorLanguage;
    problems: readonly Problem[];
    info: HoverInfo | null;
    anchor: EditorPosition;
    position: EditorPosition;
}) {
    const { t } = useTranslation('editor');
    return (
        <div className="flex w-max min-w-[280px] max-w-[min(520px,calc(100vw-16px))] flex-col divide-y divide-border">
            {info !== null && (
                <>
                    <SymbolSections
                        text={info.text}
                        onName={(name, declared) => {
                            language.hover.hide();
                            void language.navigation.goToName(name, anchor, name === (declared ?? info.word) ? info.definition : null);
                        }}
                    />
                    {info.plain !== true && (
                        <div className="flex flex-col gap-0.5 px-3 py-1.5 text-xs">
                            <div className="flex items-center gap-3 whitespace-nowrap">
                                {info.definition !== null && (
                                    <button type="button" className="text-accent hover:underline" onClick={() => language.goTo(info.definition!)}>
                                        {t('language.hover.definition')}
                                    </button>
                                )}
                                {info.references !== null && info.references > 0 && (
                                    <button
                                        type="button"
                                        className="text-accent hover:underline"
                                        onClick={() => {
                                            language.hover.hide();
                                            void language.peek.open(position);
                                        }}
                                    >
                                        {t('language.hover.references', { count: info.references, formatted: formatNumber(info.references) })}
                                    </button>
                                )}
                            </div>
                            {info.definition !== null && <DefinitionPlace definition={info.definition} uri={language.uri} folder={language.project.folder} />}
                        </div>
                    )}
                </>
            )}
            {problems.map((problem, index) => (
                <ProblemSection key={index} problem={problem} language={language} />
            ))}
        </div>
    );
}
