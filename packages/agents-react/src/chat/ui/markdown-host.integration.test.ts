import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

test('real Markdown links, timeline menus and shell slots retain their source context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adecore-markdown-host-'));
    let view: InstanceType<typeof Bun.WebView> | null = null;
    let server: ReturnType<typeof Bun.serve> | null = null;
    const resolve = (name: string) => JSON.stringify(Bun.resolveSync(name, import.meta.dir));
    try {
        const entry = join(directory, 'entry.tsx');
        await writeFile(
            entry,
            `
            import React from ${resolve('react')};
            import { createRoot } from ${resolve('react-dom/client')};
            import i18next from ${resolve('i18next')};
            import { UIProvider, ContextMenu } from ${resolve('@adecore/ui')};
            import { ChatHostProvider, ChatScopeContext } from ${resolve('@adecore/agents-react')};
            import { Markdown, MessageMarkdown, FileLinkContext, TimelineMenuPopup, AssistantRow, ReplyContext } from ${resolve('@adecore/agents-react/chat/ui')};
            import { readTimelineTarget, EMPTY_TARGET } from ${resolve('@adecore/agents-react/chat')};
            await i18next.init({lng:'en',resources:{en:{'agent-chat':{timeline:{menu:{openInPreview:'Open in preview'}},common:{action:{copy:'Copy',selectAll:'Select all'}}}}}});
            window.opens=[]; window.targets=[]; window.shell=[]; window.clicks=[];
            const code='  printf "héllo"  ';
            const closed='\x60\x60\x60bash\\n'+code+'\\n\x60\x60\x60\\n';
            const host={
                useStreaming:()=> 'blocks',
                code:{useMode:()=> 'light',useThemes:()=>({light:'missing-theme-for-fallback-test',dark:'missing-theme-for-fallback-test'}),custom:[]},
                fileLinks:{
                    target(text,cwd,scopeId){
                        window.targets.push({text,cwd,scopeId});
                        if(text.startsWith('https:')) return null;
                        if(text==='src/a file.ts:12:4-16') return {path:'src/a file.ts',line:scopeId==='machine-b'?99:12,column:4,endLine:scopeId==='machine-b'?103:16,directory:false};
                        if(text==='src/') return {path:'src/',directory:true};
                        return null;
                    },
                    open(cwd,ref,scopeId){window.opens.push({cwd,ref,scopeId});}
                },
                renderShellCodeBlock(context){
                    window.shell.push(context);
                    return <button data-shell-action disabled={!context.complete} onClick={()=>window.clicks.push(context)}>Prepare</button>;
                }
            };
            function Fixture(){
                const thread=React.useRef(null);
                const [target,setTarget]=React.useState(EMPTY_TARGET);
                const [machine,changeMachine]=React.useState('machine-a');
                const [cwd,changeCwd]=React.useState('/original-cwd');
                const [streaming,changeStreaming]=React.useState(true);
                const [text,changeText]=React.useState(closed+'\\nReply continues.\\n');
                const [child,changeChild]=React.useState(false);
                window.changeMachine=()=>{changeMachine('machine-b');changeCwd('/other-cwd');};
                window.changeCwd=changeCwd;window.changeStreaming=changeStreaming;window.changeText=changeText;window.changeChild=changeChild;
                const scope={id:machine,keyOf:id=>machine+'/'+id,owns:key=>key.startsWith(machine+'/'),transport:{},chats:{}};
                return <ChatScopeContext.Provider value={scope}><FileLinkContext.Provider value={cwd}>
                    <ContextMenu.Root><ContextMenu.Trigger ref={thread} data-file-cwd={cwd} data-file-scope-id={machine}
                        onContextMenuCapture={event=>setTarget(readTimelineTarget(event.target,thread.current,[]))}>
                        <Markdown text={'[Named source](<src/a file.ts:12:4-16>) and \x60src/a file.ts:12:4-16\x60 and [Folder](src/) and [Web](https://example.com)'}/>
                        <MessageMarkdown text="@src/" mentions={['src/']}/>
                        <Markdown text={closed} fileLinks={false}/>
                        <ReplyContext.Provider value={child?{provider:'claude',chatId:'child-chat'}:null}>
                            <AssistantRow chatId="main-chat" item={{id:'main-item',kind:'assistant',turnId:null,createdAt:0,text,streaming}}/>
                        </ReplyContext.Provider>
                    </ContextMenu.Trigger><TimelineMenuPopup target={target} thread={thread}/></ContextMenu.Root>
                </FileLinkContext.Provider></ChatScopeContext.Provider>;
            }
            createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatHostProvider host={host}><Fixture/></ChatHostProvider></UIProvider>);
        `
        );
        const build = await Bun.build({
            entrypoints: [entry],
            target: 'browser',
            conditions: ['source'],
            plugins: [
                {
                    name: 'fixture-react',
                    setup(builder) {
                        builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: Bun.resolveSync(path, import.meta.dir) }));
                    }
                }
            ]
        });
        if (!build.success) {
            throw new AggregateError(build.logs, 'Could not bundle the Markdown host fixture');
        }
        const script = await build.outputs[0]!.text();
        const theme = await readFile(join(import.meta.dir, '../../../../ui/src/theme.css'), 'utf8');
        server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request) {
                return new URL(request.url).pathname === '/entry.js'
                    ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
                    : new Response(
                          `<!doctype html><style>${theme}body{margin:16px}svg{width:14px;height:14px}.invisible{visibility:hidden}</style><div id="root"></div><script>window.errors=[];window.addEventListener('error',event=>errors.push(event.message));window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));</script><script type="module" src="/entry.js"></script>`,
                          { headers: { 'Content-Type': 'text/html' } }
                      );
            }
        });
        view = new Bun.WebView({ backend: { type: 'chrome', url: false }, headless: true, dataStore: { directory: join(directory, 'profile') } });
        const browser = view;
        const waitFor = async (expression: string): Promise<void> => {
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                if (await browser.evaluate<boolean>(expression)) {
                    return;
                }
                await browser.evaluate<unknown>(frame);
            }
            throw new Error(`Browser condition did not settle: ${expression}`);
        };
        const click = async (selector: string, button: 'left' | 'right' = 'left'): Promise<void> => {
            const point = await browser.evaluate<{ x: number; y: number }>(
                `(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`
            );
            await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
            await browser.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 });
            await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, buttons: 0, clickCount: 1 });
            await browser.evaluate<unknown>(frame);
        };
        await browser.navigate(`http://127.0.0.1:${server.port}`);
        await browser.resize(900, 700);
        await waitFor('document.querySelectorAll("[data-file-path]").length===4');
        const expected = { cwd: '/original-cwd', scopeId: 'machine-a', ref: { path: 'src/a file.ts', line: 12, column: 4, endLine: 16, directory: false } };
        await click('[data-file-path]');
        await click('[data-file-path]:nth-of-type(2)');
        expect(await browser.evaluate<unknown>('window.opens')).toEqual([expected, expected]);
        await click('[data-file-path]', 'right');
        await waitFor('document.querySelector("[role=menuitem]:last-child")!==null');
        await browser.evaluate<unknown>('window.changeMachine()');
        await browser.evaluate<unknown>(frame);
        await click('[role=menuitem]:last-child');
        expect(await browser.evaluate<unknown>('window.opens.at(-1)')).toEqual(expected);
        await click('[data-file-path]');
        expect(await browser.evaluate<unknown>('window.opens.at(-1)')).toEqual({
            ...expected,
            cwd: '/other-cwd',
            scopeId: 'machine-b',
            ref: { ...expected.ref, line: 99, endLine: 103 }
        });
        await click('span[data-file-path="src/"]', 'right');
        await waitFor('document.querySelector("[role=menuitem]:last-child")!==null');
        await browser.evaluate<unknown>('window.changeCwd("/child-cwd")');
        await browser.evaluate<unknown>(frame);
        await click('[role=menuitem]:last-child');
        expect(await browser.evaluate<unknown>('window.opens.at(-1)')).toEqual({
            cwd: '/other-cwd',
            scopeId: 'machine-b',
            ref: { path: 'src/', directory: true }
        });
        expect(await browser.evaluate<unknown>('window.targets.some(target=>target.scopeId==="machine-a"&&target.cwd==="/original-cwd")')).toBe(true);
        expect(await browser.evaluate<unknown>('document.querySelector(\'a[href="https://example.com"]\')!==null')).toBe(true);
        expect(await browser.evaluate<unknown>('window.shell.every(context=>context.complete===false)')).toBe(true);
        expect(await browser.evaluate<unknown>('window.clicks')).toEqual([]);
        await browser.evaluate<unknown>('window.changeStreaming(false)');
        await browser.evaluate<unknown>(frame);
        await waitFor('document.querySelector("[data-shell-action]:not([disabled])")!==null');
        await waitFor('document.querySelectorAll(".chat-code pre:not(.invisible)").length===2');
        expect(await browser.evaluate<boolean>('document.querySelector("[data-shell-action]").closest(".invisible")===null')).toBe(true);
        await click('[data-shell-action]');
        expect(await browser.evaluate<unknown>('window.clicks')).toEqual([
            { scopeId: 'machine-b', chatId: 'main-chat', itemId: 'main-item', language: 'bash', code: '  printf "héllo"  ', complete: true }
        ]);
        await browser.evaluate<unknown>('window.changeText("```bash\\nprintf unfinished")');
        await browser.evaluate<unknown>(frame);
        await waitFor('document.querySelector("[data-shell-action][disabled]")!==null');
        await browser.evaluate<unknown>('window.changeChild(true)');
        await browser.evaluate<unknown>(frame);
        await waitFor('document.querySelector("[data-shell-action]")===null');
        expect(await browser.evaluate<unknown>('window.errors')).toEqual([]);
    } finally {
        view?.close();
        await server?.stop(true);
        await rm(directory, { recursive: true, force: true });
    }
});
