import { createPortal } from 'react-dom';
import { useSyncExternalStore, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorLanguage } from './editor-language.ts';
import { DOC_LINK_PREFIX, sectionsOf, type DocTagEntry } from './doc-comment-model.ts';
import { markdownParts } from './hover-content.ts';
import { Signature } from './HoverSections.tsx';
import { shikiLanguageOf } from './language-ids.ts';
import { Markdown } from './Markdown.tsx';
import type { RenderedDocEntry } from './rendered-docs.ts';

const LINK = /\[([^\]]*)\]\(#doc-link:[^)]*\)/g;
const KNOWN = new Set([
    'deprecated',
    'template',
    'param',
    'property',
    'type',
    'var',
    'return',
    'yield',
    'throws',
    'see',
    'example',
    'since',
    'version',
    'author'
]);

/* Code in the editor's face, with a type fainter than a name. */
function Code({ children, faint = false }: { children: string; faint?: boolean }) {
    return <code className={`font-mono text-code break-words ${faint ? 'text-text-faint' : 'text-text'}`}>{children}</code>;
}

/* Markdown prose and fenced code as the hover draws them: the blocks in the code face, the rest muted. */
function Prose({ text, language, linkable, compact = false }: { text: string; language: string; linkable: boolean; compact?: boolean }) {
    const plain = linkable ? text : text.replace(LINK, '$1');
    return (
        <>
            {markdownParts(plain).map((part, index) =>
                part.kind === 'code' ? (
                    <div key={index} className="rounded-md bg-surface-sunken px-2 py-1.5">
                        <Signature code={part.block.code} language={part.block.language === 'text' ? language : part.block.language} />
                    </div>
                ) : (
                    <div key={index} className={`[&_.adecore-editor-markdown]:text-xs ${compact ? '[&_p]:my-0' : '[&_p]:my-1'}`}>
                        <Markdown text={part.text} images={false} />
                    </div>
                )
            )}
        </>
    );
}

/* A value of a tag, in the second column of the table; `spaced` opens a new section with more room above. */
function TagRow({ tag, language, linkable, spaced }: { tag: DocTagEntry; language: string; linkable: boolean; spaced: boolean }) {
    const target = tag.name === 'see' && tag.subject !== null ? tag.subject : null;
    const link =
        target === null ? null : /^https?:\/\//i.test(target) ? `[${target}](${target})` : `[\`${target}\`](${DOC_LINK_PREFIX}${encodeURIComponent(target)})`;
    return (
        <dd className={`col-start-2 m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 ${spaced ? 'mt-1' : ''}`}>
            {tag.name === 'example' ? (
                <div className="w-full rounded-md bg-surface-sunken px-2 py-1.5">
                    <Signature code={tag.text} language={language} />
                </div>
            ) : (
                <>
                    {tag.subject !== null && target === null && <Code>{tag.subject}</Code>}
                    {tag.type !== null && <Code faint>{tag.type}</Code>}
                    {(link !== null || tag.text !== '') && (
                        <div className="min-w-0 grow basis-48 text-text">
                            <Prose
                                text={[link, tag.text].filter((part) => part !== null && part !== '').join(' ')}
                                language={language}
                                linkable={linkable}
                                compact
                            />
                        </div>
                    )}
                </>
            )}
        </dd>
    );
}

export function RenderedDocBlock({ language, entry }: { language: EditorLanguage; entry: RenderedDocEntry }) {
    const { t } = useTranslation('editor');
    const feature = language.renderedDocs;
    const { description, tags } = entry.parsed;
    const highlighter = shikiLanguageOf(language.languageId);
    const linkable = feature.canFollow;
    const sections = sectionsOf(tags);
    const deprecated = sections.find((section) => section.name === 'deprecated');
    const shown = sections.filter((section) => section.name !== 'deprecated');

    // One handler for every link, since the links are made by the Markdown renderer and not by us.
    const follow = (event: MouseEvent<HTMLDivElement>): void => {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
        if (anchor === null) {
            return;
        }
        event.preventDefault();
        const mod = language.apple ? event.metaKey : event.ctrlKey;
        const href = anchor.getAttribute('href') ?? '';
        if (!mod) {
            return;
        }
        if (href.startsWith(DOC_LINK_PREFIX)) {
            feature.follow(decodeURIComponent(href.slice(DOC_LINK_PREFIX.length)), entry.comment);
        } else if (/^(https?:|mailto:)/i.test(href)) {
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div className="adecore-rendered-doc flex max-w-[520px] flex-col gap-1.5 py-1 font-sans text-xs/[18px] text-text select-text" onClick={follow}>
            {deprecated !== undefined && (
                <div className="border-l-2 border-status-error pl-2 text-text-muted">
                    <span className="font-medium text-status-error">{t('language.docs.deprecated')}</span>
                    {deprecated.tags.some((tag) => tag.text !== '') && (
                        <Prose text={deprecated.tags.map((tag) => tag.text).join(' ')} language={highlighter} linkable={linkable} />
                    )}
                </div>
            )}
            {description !== '' && (
                <div className="text-text">
                    <Prose text={description} language={highlighter} linkable={linkable} />
                </div>
            )}
            {shown.length > 0 && (
                <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5">
                    {shown.map((section, row) => [
                        <dt key={`${section.name}:label`} className={`col-start-1 font-medium text-text-muted ${row > 0 ? 'mt-1' : ''}`}>
                            {KNOWN.has(section.name) ? t(`language.docs.tags.${section.name}`) : `${section.name}:`}
                        </dt>,
                        ...section.tags.map((tag, index) => (
                            <TagRow key={`${section.name}:${index}`} tag={tag} language={highlighter} linkable={linkable} spaced={row > 0 && index === 0} />
                        ))
                    ])}
                </dl>
            )}
        </div>
    );
}

/*
 * The documentation comments the editor drew as rows, filled with their formatted text. It portals into
 * the element the editor made for each row, so the editor decides what is in view; a comment is parsed
 * only once its row is. Links in the text are followed with Cmd (Ctrl elsewhere) held, as definitions are.
 */
export function RenderedDocs({ language }: { language: EditorLanguage }) {
    const feature = language.renderedDocs;
    useSyncExternalStore(feature.subscribe, feature.getVersion, feature.getVersion);
    return <>{feature.entries().map((entry) => createPortal(<RenderedDocBlock language={language} entry={entry} />, entry.container, entry.id))}</>;
}
