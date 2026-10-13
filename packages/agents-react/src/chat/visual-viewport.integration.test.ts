import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_HOST_PAGE, injectVisualBootstrap } from '@adecore/agent-contracts/visual';

test('a sandboxed visual follows the timeline while its own controls retain their scroll', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adecore-visual-viewport-'));
    const theme = await readFile(join(import.meta.dir, '../theme.css'), 'utf8');
    const fixture =
        injectVisualBootstrap(`<!doctype html><style>body{margin:0}#content{height:6000px;position:relative}#nested{position:absolute;top:180px;left:20px;width:180px;height:140px;overflow:auto}#target{position:absolute;top:3200px}#editable{position:absolute;top:80px;left:20px}a{position:absolute;top:30px;left:20px}@media(max-width:700px){body.responsive #content{height:7200px}}</style>
        <div id="content"><a href="#target">Jump</a><input id="editable" value="Keep typing"><div id="nested"><div style="height:600px">Scrollable mockup</div></div><button id="target">Deep target</button></div>
        <script>window.addEventListener('message', function(event) {
            if(event.source !== parent || event.data?.kind !== 'test-state') return;
            if(event.data.responsive !== undefined) document.body.classList.toggle('responsive', event.data.responsive);
            if(event.data.value) document.getElementById('editable').value = event.data.value;
            if(event.data.contentWidth !== undefined) document.getElementById('content').style.width = event.data.contentWidth ? event.data.contentWidth + 'px' : '';
            if(event.data.left !== undefined) window.scrollTo({left:event.data.left,top:window.scrollY,behavior:'instant'});
            if(event.data.height) document.getElementById('content').style.height = event.data.height + 'px';
            if(event.data.short) { document.getElementById('content').innerHTML = ''; document.getElementById('content').style.height = '240px'; }
            if(event.data.nestedEnd) document.getElementById('nested').scrollTop = 600;
            parent.postMessage({kind:'test-state', top:scrollY, left:scrollX, height:innerHeight, width:innerWidth, value:document.getElementById('editable')?.value, nested:document.getElementById('nested')?.scrollTop ?? 0, contentHeight:document.documentElement.scrollHeight, overflow:getComputedStyle(document.documentElement).overflowY, overflowX:getComputedStyle(document.documentElement).overflowX, documentWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth, contentWidth:document.getElementById('content').offsetWidth}, '*');
        });</script>`);
    const entry = join(directory, 'entry.ts');
    await writeFile(
        entry,
        `
        import { createElement } from ${JSON.stringify(join(import.meta.dir, '../../../../node_modules/react'))};
        import { createRoot } from ${JSON.stringify(join(import.meta.dir, '../../../../node_modules/react-dom/client'))};
        import { ChatHostProvider } from ${JSON.stringify(join(import.meta.dir, '../host.ts'))};
        import { ChatScopeContext } from ${JSON.stringify(join(import.meta.dir, '../scope.ts'))};
        import { VisualFrame } from ${JSON.stringify(join(import.meta.dir, 'ui/VisualFrame.tsx'))};
        import { RowContainer } from ${JSON.stringify(join(import.meta.dir, 'ui/rows/RowContainer.tsx'))};
        import { threadPaddingLeft, STRIP_CLEARANCE_PX } from ${JSON.stringify(join(import.meta.dir, 'logic/scrubber.ts'))};
        const scroller = document.getElementById('scroller');
        const host = {
            visuals: { frameUrl: location.origin + '/visual', openLink: () => {} },
            attachments: { read: async () => new Blob([${JSON.stringify(fixture)}]), useUrl: () => ({url:null}) }
        };
        const app = createRoot(document.getElementById('mount'));
        let layout;
        const render = (fill = false) => {
            const visual = {id:'page', title:'Chart', at:0, maxHeight:2000, size:1, layout};
            const frame = createElement(VisualFrame, {chatId:'test', visual, fill, key:fill?'expanded':'inline'});
            app.render(createElement(ChatHostProvider, {host}, createElement(ChatScopeContext.Provider, {value:{id:'test'}},
                createElement(RowContainer, {row:{kind:'assistant',id:'text',text:'Before'},previous:null,index:0,top:0}, createElement('p', {id:'text'}, 'Before the visual')),
                fill ? createElement('div', {'data-index':1,style:{position:'absolute',top:200,height:500,width:'100%'}}, frame)
                    : createElement(RowContainer, {row:{kind:'visual',id:'page',visual},previous:null,index:1,top:200}, frame)
            )));
        };
        window.setLayout = next => { layout = next; render(); };
        window.resizePane = (width, strip = false) => {
            scroller.style.width = width + 'px';
            const thread = document.getElementById('thread');
            const padding = threadPaddingLeft(width, strip);
            thread.style.paddingLeft = padding + 'px';
            thread.style.setProperty('--chat-wide-inset', (2 * (strip ? STRIP_CLEARANCE_PX : padding) - padding) + 'px');
        };
        render();
        window.expanded = false;
        window.frameReady = false;
        window.addEventListener('message', event => {
            if(event.source === document.querySelector('iframe')?.contentWindow && event.data?.method === 'adecore/visual/viewport-ready') window.frameReady = true;
        });
        window.expand = () => {
            window.expanded = true;
            window.frameReady = false;
            const mount = document.getElementById('mount');
            mount.style.position = 'relative';
            mount.style.height = '900px';
            render(true);
        };
        window.sample = (command = {}) => new Promise(resolve => {
            const frame = document.querySelector('iframe');
            const box = frame.parentElement.parentElement;
            const receive = event => {
                if(event.source !== frame.contentWindow || event.data?.kind !== 'test-state') return;
                window.removeEventListener('message',receive);
                resolve({...event.data, scroll:scroller.scrollTop, boxHeight:box.offsetHeight, frameHeight:frame.offsetHeight, frameTop:frame.getBoundingClientRect().top, frameLeft:frame.getBoundingClientRect().left, frameWidth:frame.offsetWidth, textWidth:document.getElementById("text").offsetWidth, textLeft:document.getElementById("text").getBoundingClientRect().left, scrollWidth:scroller.scrollWidth, paneWidth:scroller.clientWidth});
            };
            window.addEventListener('message',receive);
            frame.contentWindow.postMessage({kind:'test-state',...command},'*');
        });
        window.move = top => {scroller.scrollTop = top;};
        window.ready = () => {const f = document.querySelector('iframe');return f?.offsetHeight === (window.expanded ? 500 : 600) && f.style.colorScheme !== 'normal';};
    `
    );
    const build = await Bun.build({ entrypoints: [entry], target: 'browser', conditions: ['source'] });
    expect(build.success).toBe(true);
    const script = await build.outputs[0]!.text();
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === '/visual') {
                return new Response(VISUAL_HOST_PAGE, {
                    headers: {
                        'Content-Type': 'text/html',
                        'Content-Security-Policy': "sandbox allow-scripts allow-forms; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
                    }
                });
            }
            if (path === '/entry.js') {
                return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
            }
            return new Response(
                `<!doctype html><style>${theme}</style><style>*{box-sizing:border-box}body{margin:0;padding:30px}#thread{padding-inline:16px}.inset-x-0{left:0;right:0}.mx-auto{margin-inline:auto}#scroller{width:640px;height:600px;overflow:auto;overflow-anchor:none}.pointer-events-none{pointer-events:none}.relative{position:relative}.sticky{position:sticky}.top-0{top:0}.w-full{width:100%}.size-full{width:100%;height:100%}.absolute{position:absolute}.inset-0{inset:0}iframe{display:block;width:100%;height:100%;border:0}.message{height:200px}</style>
                <div style="position:relative;width:640px"><div id="scroller" class="chat-scroll chat-column"><div id="thread"><div id="mount" style="position:relative;height:6400px"></div></div></div><div id="composer" style="position:absolute;bottom:0;width:100%;height:100px;background:rgba(255,255,255,.8)"></div></div><script type="module" src="/entry.js"></script>`,
                { headers: { 'Content-Type': 'text/html' } }
            );
        }
    });
    const errors: string[] = [];
    const view = new Bun.WebView({
        backend: { type: 'chrome', url: false },
        headless: true,
        dataStore: { directory: join(directory, 'profile') },
        console: (level, ...values) => {
            if (level === 'error') {
                errors.push(values.join(' '));
            }
        }
    });
    const waitFor = async (expression: string): Promise<void> => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            if (await view.evaluate<boolean>(expression)) {
                return;
            }
            await Bun.sleep(20);
        }
        throw new Error(`Condition did not settle: ${expression}\n${errors.join('\n')}\n${JSON.stringify(await view.evaluate('sample()'))}`);
    };
    const wheel = async (x: number, y: number, deltaY: number, deltaX = 0, modifiers = 0): Promise<void> => {
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers });
    };
    try {
        await view.navigate(`http://127.0.0.1:${server.port}`);
        await view.resize(760, 720);
        await waitFor('window.ready?.() === true');
        await waitFor('(async()=> (await sample()).boxHeight === 6000)()');
        for (const top of [0, 100, 200, 1700, 5700, 5900]) {
            await view.evaluate(`move(${top})`);
            const offset = Math.max(0, Math.min(top - 200, 5400));
            await waitFor(`(async()=> Math.abs((await sample()).top - ${offset}) < 1)()`);
            const state = await view.evaluate<{ frameHeight: number; frameTop: number; scroll: number }>('sample()');
            expect(state.frameHeight).toBe(600);
            expect(state.frameTop).toBeCloseTo(230 - state.scroll + offset, 0);
        }
        await view.evaluate("document.getElementById('scroller').style.height = '500px'");
        await waitFor('(async()=> (await sample()).frameHeight === 500)()');
        await view.evaluate("document.getElementById('scroller').style.height = '600px'");
        await waitFor('(async()=> (await sample()).frameHeight === 600)()');
        await view.evaluate('move(200)');
        await waitFor('(async()=> (await sample()).top === 0)()');
        expect(await view.evaluate<number>('document.querySelector("iframe").getBoundingClientRect().bottom')).toBe(630);
        expect(await view.evaluate<string>('document.elementFromPoint(400,580).id')).toBe('composer');
        await view.evaluate('sample({contentWidth:1800})');
        await wheel(400, 450, 0, 120);
        await waitFor('(async()=> (await sample()).left >= 120)()');
        const horizontal = await view.evaluate<{ left: number; scroll: number; top: number }>('sample()');
        expect(horizontal.scroll).toBe(200);
        expect(horizontal.top).toBe(0);
        await wheel(400, 450, 120);
        await waitFor('(async()=> (await sample()).scroll >= 320)()');
        expect((await view.evaluate<{ left: number }>('sample()')).left).toBe(horizontal.left);
        await view.evaluate('move(200)');
        await waitFor('(async()=> (await sample()).top === 0)()');
        await wheel(400, 450, 0, 120, 8);
        await waitFor(`(async()=> (await sample()).left > ${horizontal.left})()`);
        expect((await view.evaluate<{ scroll: number }>('sample()')).scroll).toBe(200);
        await view.evaluate('sample({left:0})');
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 440 }] });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 280, y: 440 }] });
        await waitFor('(async()=> (await sample()).left > 0)()');
        expect((await view.evaluate<{ scroll: number }>('sample()')).scroll).toBe(200);
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await view.evaluate('sample({contentWidth:0,left:0})');
        await view.evaluate('move(200)');
        await waitFor('(async()=> (await sample()).top === 0)()');
        await wheel(100, 260, 80);
        await waitFor('(async()=> (await sample()).nested > 0)()');
        expect((await view.evaluate<{ scroll: number }>('sample()')).scroll).toBe(200);
        await view.evaluate('sample({nestedEnd:true})');
        await wheel(100, 260, 80);
        await waitFor('(async()=> (await sample()).scroll > 200)()');
        await view.evaluate('move(200)');
        await waitFor('(async()=> (await sample()).top === 0)()');
        await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 120, button: 'left', clickCount: 1 });
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 120, button: 'left', clickCount: 1 });
        await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
        await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
        expect((await view.evaluate<{ scroll: number }>('sample()')).scroll).toBe(200);
        await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 75, y: 70, button: 'left', clickCount: 1 });
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 75, y: 70, button: 'left', clickCount: 1 });
        await waitFor('(async()=> (await sample()).scroll >= 3300)()');
        await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
        await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
        await waitFor('(async()=> (await sample()).scroll > 3700)()');
        await view.evaluate('move(200)');
        await waitFor('(async()=> (await sample()).top === 0)()');
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 440 }] });
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400, y: 320 }] });
        await waitFor('(async()=> (await sample()).scroll > 200)()');
        await view.cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        await view.resize(1400, 720);
        await view.evaluate("(()=> {move(1700); resizePane(1280); return sample({value:'Retained',responsive:true});})()");
        await waitFor('(async()=> {const s=await sample();return s.frameWidth===768 && s.boxHeight===6000 && s.top===1500;})()');
        const inline = await view.evaluate<{ frameLeft: number; textLeft: number }>('sample()');
        expect(inline.frameLeft).toBe(inline.textLeft);
        await view.evaluate("setLayout('wide')");
        await waitFor('(async()=> (await sample()).frameWidth===1216)()');
        await view.evaluate('resizePane(1280,true)');
        await waitFor('(async()=> (await sample()).frameWidth===1120)()');
        const wide = await view.evaluate<{ frameLeft: number; textWidth: number; value: string; scroll: number }>('sample()');
        expect(wide.frameLeft).toBe(110);
        expect(wide.textWidth).toBe(768);
        expect(wide.value).toBe('Retained');
        expect(wide.scroll).toBe(1700);
        await view.evaluate('resizePane(680)');
        await waitFor('(async()=> {const s=await sample();return s.frameWidth===616 && s.boxHeight===7200;})()');
        await view.evaluate('resizePane(360,true)');
        await waitFor('(async()=> (await sample()).frameWidth===224)()');
        const narrow = await view.evaluate<{
            frameWidth: number;
            textWidth: number;
            scrollWidth: number;
            paneWidth: number;
            scroll: number;
            top: number;
            value: string;
        }>('sample()');
        expect(narrow.frameWidth).toBeLessThan(narrow.textWidth);
        expect(narrow.scrollWidth).toBe(narrow.paneWidth);
        expect(narrow.scroll).toBe(1700);
        expect(narrow.top).toBe(1500);
        expect(narrow.value).toBe('Retained');
        await view.evaluate("(()=> {resizePane(640); setLayout('inline'); return sample({responsive:false});})()");
        await waitFor('(async()=> (await sample()).boxHeight===6000)()');
        await view.evaluate('sample({height:8200})');
        await waitFor('(async()=> (await sample()).boxHeight === 8200)()');
        await view.evaluate('move(200)');
        await view.evaluate('sample({short:true})');
        await waitFor('(async()=> {const s=await sample(); return s.boxHeight===240 && s.frameHeight===240 && s.top===0;})()');
        await view.evaluate('expand()');
        await waitFor('window.frameReady && window.ready()');
        await view.evaluate('move(200)');
        await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await wheel(400, 200, 120);
        await waitFor('(async()=> (await sample()).top > 0)()');
        expect((await view.evaluate<{ scroll: number }>('sample()')).scroll).toBe(200);
        expect(errors).toEqual([]);
    } finally {
        view.close();
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
    }
}, 60_000);
