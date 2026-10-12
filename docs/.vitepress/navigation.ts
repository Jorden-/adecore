import type { DefaultTheme } from 'vitepress';

function group(text: string, items: [string, string][]): DefaultTheme.SidebarItem {
    return {
        text,
        collapsed: false,
        items: items.map(([label, link]) => ({ text: label, link }))
    };
}

const guide: DefaultTheme.SidebarItem[] = [group('Guide', [['Introduction', '/guide/']])];

const desktopUi: DefaultTheme.SidebarItem[] = [
    group('UI', [
        ['Overview', '/ui/'],
        ['Getting started', '/ui/guide/getting-started'],
        ['Principles', '/ui/guide/principles'],
        ['Theme', '/ui/guide/theme']
    ]),
    group('Actions', [
        ['Button', '/ui/actions/button'],
        ['IconButton', '/ui/actions/icon-button'],
        ['ButtonGroup', '/ui/actions/button-group'],
        ['CloseButton', '/ui/actions/close-button'],
        ['Pill', '/ui/actions/pill'],
        ['Tile', '/ui/actions/tile']
    ]),
    group('Inputs', [
        ['Field', '/ui/inputs/field'],
        ['Input and TextArea', '/ui/inputs/input'],
        ['Select', '/ui/inputs/select'],
        ['Switch', '/ui/inputs/switch'],
        ['Checkbox', '/ui/inputs/checkbox'],
        ['Segmented', '/ui/inputs/segmented'],
        ['Stepper', '/ui/inputs/stepper'],
        ['Slider', '/ui/inputs/slider'],
        ['ChoiceCards', '/ui/inputs/choice-cards'],
        ['IconPicker', '/ui/inputs/icon-picker'],
        ['ColorSwatch', '/ui/inputs/color-swatch'],
        ['AccentSwatches', '/ui/inputs/accent-swatches']
    ]),
    group('Overlays', [
        ['Menu', '/ui/overlays/menu'],
        ['ProjectSwitcher', '/ui/overlays/project-switcher'],
        ['ContextMenu', '/ui/overlays/context-menu'],
        ['Dialog', '/ui/overlays/dialog'],
        ['PromptDialog', '/ui/overlays/prompt-dialog'],
        ['Popover', '/ui/overlays/popover'],
        ['PreviewCard', '/ui/overlays/preview-card'],
        ['Tooltip', '/ui/overlays/tooltip'],
        ['DisabledReason', '/ui/overlays/disabled-reason'],
        ['TextMenu', '/ui/overlays/text-menu'],
        ['Toasts', '/ui/overlays/toasts']
    ]),
    group('Display', [
        ['Kbd, KeyCap and Keys', '/ui/display/kbd'],
        ['ShortcutHints', '/ui/display/shortcut-hints'],
        ['Icon', '/ui/display/icon'],
        ['FileIcon', '/ui/display/file-icon'],
        ['SectionLabel', '/ui/display/section-label'],
        ['Surface', '/ui/display/surface'],
        ['ListRow', '/ui/display/list-row'],
        ['KeyValueList', '/ui/display/key-value-list'],
        ['PanelHeader', '/ui/display/panel-header'],
        ['Separator', '/ui/display/separator'],
        ['Skeleton', '/ui/display/skeleton'],
        ['Spinner', '/ui/display/spinner'],
        ['SegmentBar', '/ui/display/segment-bar'],
        ['Meter', '/ui/display/meter'],
        ['Waveform', '/ui/display/waveform'],
        ['EmptyState', '/ui/display/empty-state'],
        ['PanelEmpty', '/ui/display/panel-empty'],
        ['Banner', '/ui/display/banner'],
        ['ErrorBoundary', '/ui/display/error-boundary']
    ]),
    group('FileTree and Tree', [
        ['FileTree', '/ui/display/file-tree'],
        ['Models, loading and expansion', '/ui/display/file-tree/models-loading'],
        ['Interaction and row controls', '/ui/display/file-tree/interaction-controls'],
        ['FileTree reference', '/ui/display/file-tree/reference'],
        ['Tree', '/ui/display/tree'],
        ['Tree reference', '/ui/display/tree/reference']
    ]),
    group('Layout', [
        ['Tabs', '/ui/layout/tabs'],
        ['TabStrip', '/ui/layout/tab-strip'],
        ['SplitView', '/ui/layout/split-view'],
        ['Workspace', '/ui/layout/workspace'],
        ['SlidingColumn', '/ui/layout/sliding-column'],
        ['ColumnResizeHandle', '/ui/layout/column-resize-handle'],
        ['DockShell', '/ui/layout/dock-shell'],
        ['ZoomControls', '/ui/layout/zoom-controls'],
        ['Wipe', '/ui/layout/wipe']
    ]),
    group('Settings', [
        ['SettingsDialog', '/ui/settings/settings-dialog'],
        ['SettingsSection and SettingsRow', '/ui/settings/settings-section'],
        ['MasterDetail', '/ui/settings/master-detail'],
        ['ConfirmDialog', '/ui/settings/confirm-dialog']
    ]),
    group('Formatting', [
        ['Format source', '/ui/formatting/'],
        ['Numbers', '/ui/formatting/numbers'],
        ['Dates and times', '/ui/formatting/dates'],
        ['Durations', '/ui/formatting/durations'],
        ['Regions', '/ui/formatting/regions']
    ]),
    group('Hooks', [
        ['useAsyncAction', '/ui/hooks/use-async-action'],
        ['useColumnResize', '/ui/hooks/use-column-resize'],
        ['useContentSize', '/ui/hooks/use-content-size'],
        ['useNow', '/ui/hooks/use-now']
    ]),
    group('Utilities', [
        ['UIProvider', '/ui/utilities/ui-provider'],
        ['Shortcuts', '/ui/utilities/shortcuts'],
        ['Lazy loading', '/ui/utilities/lazy-loading'],
        ['Clipboard and selection', '/ui/utilities/clipboard'],
        ['Floating layers', '/ui/utilities/floating-layers'],
        ['Error messages', '/ui/utilities/error-messages'],
        ['Testing', '/ui/utilities/testing']
    ])
];

const desktopShell: DefaultTheme.SidebarItem[] = [
    group('Shell', [
        ['Overview', '/shell/'],
        ['Application menu', '/shell/menu'],
        ['Updater', '/shell/updater'],
        ['Windows', '/shell/windows'],
        ['Window state', '/shell/window-state'],
        ['Theme', '/shell/theme'],
        ['Web guards', '/shell/web-guards'],
        ['App scheme', '/shell/app-scheme'],
        ['Bridge', '/shell/bridge']
    ])
];

const terminal: DefaultTheme.SidebarItem[] = [group('Terminal', [['TerminalView', '/terminal/']])];

const database: DefaultTheme.SidebarItem[] = [
    group('Database', [
        ['Overview', '/database/'],
        ['Getting started', '/database/guide/getting-started'],
        ['Connections', '/database/guide/connections'],
        ['Opening tables as tabs', '/database/guide/tabs'],
        ['Files', '/database/guide/files'],
        ['Security', '/database/guide/security'],
        ['Protocol', '/database/guide/protocol']
    ]),
    group('Views', [
        ['ConnectionManager', '/database/views/connection-manager'],
        ['DatabaseExplorer', '/database/views/explorer'],
        ['TableView', '/database/views/table-view'],
        ['StructureView', '/database/views/structure-view'],
        ['TableDesigner', '/database/views/table-designer'],
        ['QueryConsole', '/database/views/query-console'],
        ['DatabaseWorkbench', '/database/views/workbench']
    ]),
    group('API', [
        ['Client', '/database/api/client'],
        ['Host', '/database/api/host'],
        ['Testing', '/database/api/testing']
    ])
];

export const sidebar: DefaultTheme.SidebarMulti = {
    '/guide/': guide,
    '/ui/': desktopUi,
    '/shell/': desktopShell,
    '/terminal/': terminal,
    '/database/': database,
    '/agent-contracts/': [
        group('Agent contracts', [
            ['Overview', '/agent-contracts/'],
            ['Protocol', '/agent-contracts/protocol'],
            ['Conversation', '/agent-contracts/conversation'],
            ['Visuals', '/agent-contracts/visuals'],
            ['Providers and accounts', '/agent-contracts/providers-and-accounts'],
            ['Tasks and usage', '/agent-contracts/tasks-and-usage']
        ]),
        group('Reference', [['Exports', '/agent-contracts/reference']])
    ],
    '/agents/': [
        group('Agents', [
            ['Overview', '/agents/'],
            ['Getting started', '/agents/getting-started'],
            ['Host', '/agents/host'],
            ['Chats and turns', '/agents/chats'],
            ['Providers', '/agents/providers'],
            ['Accounts and usage', '/agents/accounts'],
            ['Coordination', '/agents/coordination'],
            ['Context commands', '/agents/context-commands'],
            ['Storage', '/agents/storage'],
            ['Testing', '/agents/testing']
        ]),
        group('Reference', [['Modules', '/agents/reference']])
    ],
    '/intelligent-ui/': [
        group('Intelligent UI', [
            ['Overview', '/intelligent-ui/'],
            ['Getting started', '/intelligent-ui/guide/getting-started'],
            ['Security model', '/intelligent-ui/guide/security']
        ]),
        group('Language', [
            ['Syntax', '/intelligent-ui/language/syntax'],
            ['Expressions', '/intelligent-ui/language/expressions'],
            ['State and inputs', '/intelligent-ui/language/state']
        ]),
        group('Components', [
            ['Status', '/intelligent-ui/components/status'],
            ['Data', '/intelligent-ui/components/data'],
            ['Structure', '/intelligent-ui/components/structure'],
            ['Content', '/intelligent-ui/components/content'],
            ['Host links', '/intelligent-ui/components/links'],
            ['Inputs', '/intelligent-ui/components/inputs'],
            ['Choices', '/intelligent-ui/components/choices']
        ]),
        group('Host integration', [
            ['Live queries', '/intelligent-ui/host/queries'],
            ['Choices', '/intelligent-ui/host/choices'],
            ['Links', '/intelligent-ui/host/links'],
            ['Compilation and streaming', '/intelligent-ui/host/compilation'],
            ['Performance', '/intelligent-ui/performance']
        ]),
        group('Reference', [['Exports', '/intelligent-ui/reference']])
    ],
    '/agents-react/': [
        group('Agent views', [
            ['Overview', '/agents-react/'],
            ['Getting started', '/agents-react/guide/getting-started'],
            ['Host adapters', '/agents-react/guide/host'],
            ['Chat client and state', '/agents-react/guide/chat-client'],
            ['Persistence', '/agents-react/guide/persistence'],
            ['Testing', '/agents-react/guide/testing']
        ]),
        group('Chat', [
            ['Timeline', '/agents-react/chat/timeline'],
            ['Composer', '/agents-react/chat/composer'],
            ['Prompts', '/agents-react/chat/prompts'],
            ['Messages and code', '/agents-react/chat/messages'],
            ['Diffs', '/agents-react/chat/diffs'],
            ['Subagents', '/agents-react/chat/subagents'],
            ['Limits', '/agents-react/chat/limits'],
            ['Chat parts', '/agents-react/chat/parts'],
            ['Attachments and mentions', '/agents-react/chat/attachments'],
            ['Intelligent UI', '/agents-react/chat/intelligent-ui'],
            ['Visuals', '/agents-react/chat/visuals']
        ]),
        group('Providers', [
            ['ProvidersPane', '/agents-react/providers/providers-pane'],
            ['Model picker', '/agents-react/providers/model-picker'],
            ['Agent marks', '/agents-react/providers/marks']
        ]),
        group('Usage', [
            ['UsagePage', '/agents-react/usage/usage-page'],
            ['Charts and tiles', '/agents-react/usage/charts'],
            ['Plan limits', '/agents-react/usage/limits']
        ]),
        group('Reference', [['Modules', '/agents-react/reference']])
    ],
    '/merge/': [
        group('Merge', [
            ['Overview', '/merge/'],
            ['Lines and diffs', '/merge/lines'],
            ['Three-way merge', '/merge/three-way']
        ])
    ],
    '/drawing/': [
        group('Drawing', [
            ['Overview', '/drawing/'],
            ['Documents', '/drawing/documents'],
            ['Geometry', '/drawing/geometry'],
            ['Paths and SVG', '/drawing/rendering'],
            ['Text and reading order', '/drawing/text']
        ])
    ],
    '/diagram/': [
        group('Diagram', [
            ['Overview', '/diagram/'],
            ['Documents', '/diagram/documents'],
            ['Layout', '/diagram/layout'],
            ['Painting and reading', '/diagram/rendering']
        ])
    ],
    '/plan/': [
        group('Plan', [
            ['Overview', '/plan/'],
            ['Plans', '/plan/plans'],
            ['Operations', '/plan/operations'],
            ['Markdown and text', '/plan/markdown']
        ])
    ],
    '/service/': [
        group('Service', [
            ['Overview', '/service/'],
            ['Definitions', '/service/definitions'],
            ['Managers', '/service/managers']
        ])
    ],
    '/editor-core/': [
        group('Editor core', [
            ['Overview', '/editor-core/'],
            ['Documents and edits', '/editor-core/documents'],
            ['Typing and commands', '/editor-core/commands'],
            ['Search and folding', '/editor-core/search-folding'],
            ['API reference', '/editor-core/api']
        ])
    ],
    '/editor/': [
        group('Editor', [
            ['Overview', '/editor/'],
            ['Getting started', '/editor/getting-started'],
            ['Options and keymaps', '/editor/options'],
            ['Text and events', '/editor/editing'],
            ['Theme and syntax', '/editor/theme'],
            ['Testing', '/editor/testing']
        ]),
        group('Drawing', [
            ['Decorations', '/editor/decorations'],
            ['Rows and widgets', '/editor/rows'],
            ['Agents', '/editor/agents'],
            ['Find and folding', '/editor/find-folding']
        ]),
        group('Reference', [['Exports', '/editor/reference']])
    ],
    '/lsp/': [
        group('LSP', [
            ['Overview', '/lsp/'],
            ['Sessions and transports', '/lsp/sessions'],
            ['Documents and edits', '/lsp/documents'],
            ['Language service', '/lsp/language-service'],
            ['Testing', '/lsp/testing']
        ]),
        group('Reference', [['Exports', '/lsp/reference']])
    ],
    '/editor-react/': [
        group('Editor views', [
            ['Overview', '/editor-react/'],
            ['Getting started', '/editor-react/getting-started'],
            ['Projects and documents', '/editor-react/project'],
            ['View state', '/editor-react/view-state'],
            ['Testing', '/editor-react/testing']
        ]),
        group('Views', [
            ['EditorView', '/editor-react/editor-view'],
            ['Completion and signatures', '/editor-react/completion'],
            ['Hover and problems', '/editor-react/hover'],
            ['Navigation', '/editor-react/navigation'],
            ['Call hierarchy', '/editor-react/call-hierarchy'],
            ['Rename and code actions', '/editor-react/rename'],
            ['Format on type', '/editor-react/format-on-type'],
            ['FindReplace', '/editor-react/find-replace'],
            ['Reviews and agents', '/editor-react/change-review'],
            ['Patch files', '/editor-react/patch-files'],
            ['Code vision', '/editor-react/code-vision'],
            ['Rendered documentation', '/editor-react/rendered-documentation']
        ]),
        group('Reference', [
            ['Models', '/editor-react/models'],
            ['Exports', '/editor-react/reference']
        ])
    ]
};
