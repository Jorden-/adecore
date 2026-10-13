import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';
import { WorkspaceContext, type WorkspaceLayout } from './context.ts';

export interface WorkspaceProps extends useRender.ComponentProps<'div'> {
    layout?: WorkspaceLayout;
    toolbar?: ReactNode;
    sidebar?: ReactNode;
    sidePanel?: ReactNode;
    /** Auto-sized regions keep their own width, separators and opening animation. */
    sidebarWidth?: number | 'auto';
    sidePanelWidth?: number | 'auto';
    sidebarOpen?: boolean;
    sidePanelOpen?: boolean;
}

const isPresent = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false;

export function Workspace({
    layout = 'standard',
    toolbar,
    sidebar,
    sidePanel,
    sidebarWidth = 248,
    sidePanelWidth = 320,
    sidebarOpen,
    sidePanelOpen,
    children,
    className,
    ref,
    render,
    style,
    ...props
}: WorkspaceProps) {
    const hasSidebar = isPresent(sidebar);
    const hasPanel = isPresent(sidePanel);
    const leftOpen = hasSidebar && (sidebarOpen ?? true);
    const rightOpen = hasPanel && (sidePanelOpen ?? true);
    const hasToolbar = isPresent(toolbar);
    const element = useRender({
        render,
        ref,
        defaultTagName: 'div',
        props: {
            ...props,
            className: clsx('ade-workspace', className),
            style,
            'data-layout': layout,
            'data-toolbar': hasToolbar || undefined,
            'data-sidebar': leftOpen || undefined,
            'data-side-panel': rightOpen || undefined,
            children: (
                <>
                    {hasSidebar && (
                        <aside className="ade-workspace-sidebar" data-auto={sidebarWidth === 'auto' || undefined} style={{ width: sidebarWidth }}>
                            {sidebar}
                        </aside>
                    )}
                    <div className="ade-workspace-center">
                        {hasToolbar && <div className="ade-workspace-toolbar">{toolbar}</div>}
                        <div className="ade-workspace-content">{children}</div>
                    </div>
                    {hasPanel && (
                        <aside className="ade-workspace-side-panel" data-auto={sidePanelWidth === 'auto' || undefined} style={{ width: sidePanelWidth }}>
                            {sidePanel}
                        </aside>
                    )}
                </>
            )
        }
    });
    return <WorkspaceContext value={{ layout, edges: { top: !hasToolbar, right: !rightOpen, bottom: true, left: !leftOpen } }}>{element}</WorkspaceContext>;
}
