import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/* An image becomes its alt text, so a comment cannot make the editor fetch a page of its choosing. */
const WITHOUT_IMAGES: Components = {
    img: ({ alt }) => <>{alt ?? ''}</>
};

export function Markdown({ text, images = true }: { text: string; images?: boolean }) {
    return (
        <div className="adecore-editor-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={images ? undefined : WITHOUT_IMAGES}>
                {text}
            </ReactMarkdown>
        </div>
    );
}
