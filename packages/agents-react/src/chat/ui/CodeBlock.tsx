import { Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { ButtonGroup, IconButton } from '@adecore/ui';
import { IncrementalLines, type CodeToken } from './code-lines';
import { CodeStreamingContext } from './code-streaming';
import { WHOLE_FADE_CLASS } from './rehype-fade';
import { useChatHost } from '../../host';
import { useCodeTheme } from './code-theme';
import { loadLanguage, loadTheme, tokenizerFor, tokenStyle } from './highlighter';

const COPIED_MS = 1500;

/* A line whose tokens did not change keeps its elements, so a selection in it survives the next delta. */
const CodeLine = memo(function CodeLine({ tokens }: { tokens: CodeToken[] }) {
    return (
        <span className="line">
            {tokens.map((token, index) => (
                <span key={index} style={tokenStyle(token)}>
                    {token.content}
                </span>
            ))}
        </span>
    );
});

/*
 * A fenced block, highlighted a line at a time. Until shiki and the grammar are there it holds its
 * place invisibly, so bare code never turns colored. An open fence is tokenized as it grows, and
 * closing it does not draw it again. `view` takes the place of the code, such as what the code draws,
 * and Copy still copies the code.
 */
export function CodeBlock({ code, lang, actions, view }: { code: string; lang: string; actions?: ReactNode; view?: ReactNode }) {
    const { t } = useTranslation('agent-chat');
    const theme = useCodeTheme();
    const { custom } = useChatHost().code;
    const streaming = useContext(CodeStreamingContext);
    const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
    const copying = useRef(false);
    // What loaded last, so a block whose theme changes draws again once the new one is in.
    const [loaded, setLoaded] = useState<string | null>(null);
    const tokenizer = tokenizerFor(lang, theme);
    // Only a block that had to wait fades in; one drawn highlighted from its first frame just stands there.
    const [waited] = useState(tokenizer === null);
    const lines = useMemo(() => (tokenizer ? new IncrementalLines(tokenizer.tokenize) : null), [tokenizer]);
    const tokens = useMemo(() => lines?.update(code, !streaming) ?? null, [lines, code, streaming]);

    useEffect(() => {
        if (copyState !== 'copied') {
            return;
        }
        const timer = setTimeout(() => setCopyState('idle'), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copyState]);

    async function copy(): Promise<void> {
        if (copying.current) {
            return;
        }
        copying.current = true;
        setCopyState('copying');
        try {
            // The best-effort clipboard helper cannot distinguish a refusal from success.
            await navigator.clipboard.writeText(code);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        } finally {
            copying.current = false;
        }
    }

    useEffect(() => {
        if (tokenizer !== null) {
            return;
        }
        let cancelled = false;
        Promise.all([loadLanguage(lang), loadTheme(theme, custom)])
            .then(() => !cancelled && setLoaded(`${lang}:${theme}`))
            .catch(() => !cancelled && setLoaded('failed'));
        return () => {
            cancelled = true;
        };
    }, [lang, theme, custom, tokenizer]);

    const pending = (tokenizer === null || tokens === null) && loaded !== 'failed';
    return (
        <div className="chat-code" data-copy-state={copyState}>
            {view ?? (
                <pre
                    className={clsx(pending && 'invisible', !pending && tokens !== null && waited && WHOLE_FADE_CLASS)}
                    aria-hidden={pending || undefined}
                    style={{ color: tokenizer?.fg }}
                >
                    <code>
                        {tokens === null
                            ? code
                            : tokens.map((line, index) => (
                                  // Lines only ever grow at the end, so the place of a line is a stable key.
                                  <Fragment key={index}>
                                      <CodeLine tokens={line} />
                                      {index < tokens.length - 1 && '\n'}
                                  </Fragment>
                              ))}
                    </code>
                </pre>
            )}
            <ButtonGroup className="chat-code-actions" role="group" aria-label={t('code.actions')}>
                <IconButton
                    icon={copyState === 'copied' ? Check : Copy}
                    size="sm"
                    label={copyState === 'copied' ? t('timeline.actions.copied') : t('timeline.menu.copyCode')}
                    busy={copyState === 'copying'}
                    aria-busy={copyState === 'copying'}
                    aria-disabled={copyState === 'copying'}
                    onClick={() => void copy()}
                />
                {actions}
            </ButtonGroup>
            <span className="sr-only" role="status">
                {copyState === 'copied' ? t('timeline.actions.copied') : ''}
            </span>
            {copyState === 'failed' && (
                <p className="chat-code-error" role="alert">
                    {t('code.copyFailed')}
                </p>
            )}
        </div>
    );
}
