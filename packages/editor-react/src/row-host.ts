import type { Editor } from '@adecore/editor';

export interface HostedRow {
    id: string;
    /* Zero-based. */
    line: number;
    placement: 'above' | 'below';
    height: number;
    fixed?: boolean;
    filler?: boolean;
}

export interface HostedAction {
    id: string;
    /* Zero-based. */
    line: number;
}

/* The elements an editor made for one owner's entries, and a version React reads them by. */
abstract class ContainerHost {
    protected readonly editor: Editor;
    protected readonly owner: string;
    private readonly containers = new Map<string, HTMLElement>();
    private readonly listeners = new Set<() => void>();
    private version = 0;
    private signature = '';

    constructor(editor: Editor, owner: string) {
        this.editor = editor;
        this.owner = owner;
    }

    getVersion = (): number => this.version;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    container(id: string): HTMLElement | undefined {
        return this.containers.get(id);
    }

    /* False for the same entries again, so an editor does not measure them twice; otherwise drops the elements of entries that left. */
    protected replace(signature: string, ids: readonly string[]): boolean {
        if (signature === this.signature) {
            return false;
        }
        this.signature = signature;
        const kept = new Set(ids);
        for (const id of [...this.containers.keys()]) {
            if (!kept.has(id)) {
                this.containers.delete(id);
            }
        }
        return true;
    }

    protected mounted(id: string, container: HTMLElement): void {
        this.containers.set(id, container);
        this.bump();
    }

    protected bump(): void {
        this.version++;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

/*
 * The rows of one owner in an editor, and the elements the editor draws them in, so React can portal
 * into them. The editor makes an element again whenever its row scrolls back into view, which is why a
 * row's content never keeps state of its own.
 */
export class RowHost extends ContainerHost {
    set(rows: readonly HostedRow[]): void {
        const signature = rows.map((row) => `${row.id}@${row.line}${row.placement}:${row.height}:${row.fixed}:${row.filler}`).join('|');
        if (
            !this.replace(
                signature,
                rows.map((row) => row.id)
            )
        ) {
            return;
        }
        this.editor.setWidgets(
            rows.map((row) => ({
                id: row.filler ? `${row.id}-filler` : row.id,
                line: row.line,
                placement: row.placement,
                height: row.height,
                fixed: row.fixed,
                render: (container: HTMLElement) => {
                    if (row.filler) {
                        container.classList.add('adecore-editor-diff-filler');
                    } else {
                        this.mounted(row.id, container);
                    }
                }
            })),
            this.owner
        );
        this.bump();
    }

    clear(): void {
        this.set([]);
    }
}

/*
 * The actions of one owner after the end of lines in an editor, and the elements the editor makes for
 * them. An element lives as long as its action does, unlike a row's, so what React draws into it keeps
 * its state.
 */
export class LineActionHost extends ContainerHost {
    set(actions: readonly HostedAction[]): void {
        const signature = actions.map((action) => `${action.id}@${action.line}`).join('|');
        if (
            !this.replace(
                signature,
                actions.map((action) => action.id)
            )
        ) {
            return;
        }
        this.editor.setLineActions(
            actions.map((action) => ({
                id: action.id,
                line: action.line,
                render: (container: HTMLElement) => this.mounted(action.id, container)
            })),
            this.owner
        );
        this.bump();
    }

    clear(): void {
        this.set([]);
    }
}
