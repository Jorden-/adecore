/*
 * The components, hooks and helpers of the library. Every name here is public API; the snapshot in
 * `exports.test.ts` turns any change to this list into a diff someone has to accept.
 */

export * as ContextMenu from './context-menu/index.parts.ts';
export * as FileTree from './file-tree/index.parts.ts';
export * as Tree from './tree/index.parts.ts';
export * as Dialog from './dialog/index.parts.ts';
export * as KeyValueList from './key-value-list/index.parts.ts';
export * as Menu from './menu/index.parts.ts';
export * as Popover from './popover/index.parts.ts';
export * as PreviewCard from './preview-card/index.parts.ts';
export * as Tabs from './tabs/index.parts.ts';

export type { DialogDescriptionProps, DialogFooterProps, DialogPopupProps, DialogTextProps, DialogTitleProps } from './dialog/parts.tsx';
export type {
    MenuCheckProps,
    MenuHintProps,
    MenuLabelProps,
    MenuPopupProps,
    MenuRowActionProps,
    MenuRowProps,
    MenuRowSubmenuTriggerProps
} from './menu/parts.tsx';
export type { KeyValueListItemProps, KeyValueListNameProps, KeyValueListRootProps, KeyValueListValueProps } from './key-value-list/parts.tsx';
export type { PopoverPopupProps, PopupVariant, PreviewCardPopupProps } from './popover/parts.tsx';
export type { TabsCountProps, TabsListProps, TabsRootProps, TabsTabProps, TabsValue, TabsVariant } from './tabs/parts.tsx';

export { AccentSwatches, type AccentSwatchesProps } from './AccentSwatches.tsx';
export { Banner, type BannerProps, type BannerTone } from './Banner.tsx';
export { Button, type ButtonProps, type ButtonShape, type ButtonSize, type ButtonVariant } from './Button.tsx';
export { ButtonGroup, type ButtonGroupProps } from './ButtonGroup.tsx';
export { Checkbox, type CheckboxProps } from './Checkbox.tsx';
export { ChoiceCards, type Choice, type ChoiceCardsProps } from './ChoiceCards.tsx';
export { CloseButton, type CloseButtonProps } from './CloseButton.tsx';
export { ColorSwatch, type ColorSwatchProps } from './ColorSwatch.tsx';
export { ColumnResizeHandle, type ColumnResizeHandleProps } from './ColumnResizeHandle.tsx';
export { DisabledReason, type DisabledReasonProps } from './DisabledReason.tsx';
export { DockShell, type DockShellProps } from './DockShell.tsx';
export { EmptyState, type EmptyStateProps } from './EmptyState.tsx';
export { ErrorBoundary, type ErrorBoundaryProps } from './ErrorBoundary.tsx';
export { Field, FieldHint, FormError, type FieldHintProps, type FieldProps, type FormErrorProps } from './Field.tsx';
export { FileIcon, type FileIconProps } from './FileIcon.tsx';
export { Icon, type IconProps } from './Icon.tsx';
export { IconButton, type IconButtonProps, type IconButtonSize } from './IconButton.tsx';
export { IconPicker, type IconPickerGroup, type IconPickerProps } from './IconPicker.tsx';
export { Input, TextArea, type InputProps, type TextAreaProps } from './Input.tsx';
export { Kbd, KeyCap, Keys, type KbdProps, type KeyCapProps, type KeysProps } from './Kbd.tsx';
export { ListRow, type ListRowProps } from './ListRow.tsx';
export { Meter, type MeterProps } from './Meter.tsx';
export { MiddleTruncate, type MiddleTruncateProps } from './MiddleTruncate.tsx';
export { PanelEmpty, type PanelEmptyProps } from './PanelEmpty.tsx';
export { PanelHeader, type PanelHeaderProps } from './PanelHeader.tsx';
export { Pill, type PillProps } from './Pill.tsx';
export { PromptDialog, type PromptDialogProps } from './PromptDialog.tsx';
export { ProjectSwitcher, ProjectSwitcherGroups, type ProjectSwitcherItem, type ProjectSwitcherProps } from './ProjectSwitcher.tsx';
export { SectionLabel, type SectionLabelProps } from './SectionLabel.tsx';
export { SegmentBar, type SegmentBarPart, type SegmentBarProps } from './SegmentBar.tsx';
export { Segmented, type SegmentedOption, type SegmentedProps } from './Segmented.tsx';
export { Select, type SelectGroup, type SelectItem, type SelectProps } from './Select.tsx';
export { Separator, type SeparatorProps } from './Separator.tsx';
export { ShortcutHints } from './ShortcutHints.tsx';
export { Skeleton, type SkeletonProps } from './Skeleton.tsx';
export { Slider, type SliderProps } from './Slider.tsx';
export { SlidingColumn, type SlidingColumnProps } from './SlidingColumn.tsx';
export { Spinner, type SpinnerProps } from './Spinner.tsx';
export { Stepper, type StepperProps } from './Stepper.tsx';
export { Surface, type SurfaceProps } from './Surface.tsx';
export { Switch, type SwitchProps } from './Switch.tsx';
export { TextMenu, type TextMenuProps } from './TextMenu.tsx';
export { Tile, type TileProps } from './Tile.tsx';
export { Toasts, type ToastsProps } from './Toasts.tsx';
export { Tooltip, TooltipProvider, type TooltipProps, type TooltipSide } from './Tooltip.tsx';
export { UIProvider, type UIProviderProps } from './UIProvider.tsx';
export { Waveform, type WaveformProps } from './Waveform.tsx';
export { Wipe, type WipeProps } from './Wipe.tsx';
export { ZoomControls, type ZoomControlsProps, type ZoomLabels, type ZoomSelection } from './ZoomControls.tsx';

export { copyText, readClipboardText } from './clipboard.ts';
export { messageOf } from './error-message.ts';
export type { ResetKeys } from './error-boundary.ts';
export { FILE_TREE_ICONS } from './file-icon.ts';
export { cameThroughPortal, isInFloatingLayer } from './floating.ts';
export { LoadedComponent, lazyDialog, lazyNamed, onLazyOpenError } from './lazy.tsx';
export type { LazyComponent } from './lazy.tsx';
export { LazyBoundary } from './LazyBoundary.tsx';
export type { LazyBoundaryProps } from './LazyBoundary.tsx';
export { UI_NAMESPACE, UI_RESOURCES, addUiResources } from './locales.ts';
export { startInputModality } from './modality.ts';
export { isApplePlatform } from './platform.ts';
export { Prefetcher, prefetcher, type Loader, type WhenIdle } from './prefetch.ts';
export { selectAllWithin, selectionWithin } from './selection.ts';
export { EDIT_SHORTCUTS, KEY_SHORTCUTS, formatShortcut, isModHeld, matchesShortcut, shortcut, shortcutParts, type KeyLike, type Shortcut } from './shortcut.ts';
export {
    SUCCESS_MS,
    UNDO_MS,
    createToastStore,
    elapsedOf,
    type Toast,
    type ToastAction,
    type ToastDeadline,
    type ToastInput,
    type ToastKind,
    type ToastPatch,
    type ToastStore,
    type ToastStoreHook
} from './toast-store.ts';
export { useAsyncAction, type AsyncAction } from './useAsyncAction.ts';
export { clampColumnSize, useColumnResize, type ColumnEdge, type ColumnResize, type ColumnResizeOptions } from './useColumnResize.ts';
export { useContentSize, type ContentSize } from './useContentSize.ts';
export { useMeasuredWidth } from './useMeasuredWidth.ts';
export { useNow, useTickingText } from './useNow.ts';
export { ZOOM_PRESETS } from './zoom.ts';

export { useFileTree, type FileTreeOptions } from './file-tree/use-file-tree.ts';
export type { FileTreeRootProps } from './file-tree/parts.tsx';
export type { FileTree as FileTreeModel, FileTreeVisibleRow, FileTreeDragAndDropConfig, FileTreeDropContext, FileTreeDropResult } from '@pierre/trees';
export type { FoldKeyOf, SortRow } from './file-tree/helpers.ts';
export type {
    TreeRootProps,
    TreeRowProps,
    TreeChevronProps,
    TreeChevronSlotProps,
    TreeLabelProps,
    TreeDecorationProps,
    TreeControlProps,
    TreeCheckboxProps
} from './tree/parts.tsx';

export { Workspace, type WorkspaceProps } from './workspace/Workspace.tsx';
export type { WorkspaceLayout } from './workspace/context.ts';
export { DocumentTab, TabStrip, type DocumentTabProps, type TabStripProps, type TabStripItem } from './workspace/TabStrip.tsx';
export { SplitView, type SplitViewProps, type SplitViewInfo, type SplitViewBounds, type SplitDropTarget, type SplitDrag } from './workspace/SplitView.tsx';
export { DropPreview, type DropPreviewProps } from './workspace/DropPreview.tsx';
export { dropPreviewPath, rectDropPreview, sameDropPreview, tabDropPreview, type DropPreviewShape, type TabDrop } from './workspace/preview.ts';
export {
    createSplitLayout,
    normalizeSplitLayout,
    updateSplitLayout,
    splitPanes,
    type SplitAxis,
    type SplitSide,
    type SplitPane,
    type SplitBranch,
    type SplitNode,
    type SplitLayout,
    type SplitCommand
} from './workspace/model.ts';
export { tabGapAt, type SplitRect, type SplitEdges, type SplitMinimum } from './workspace/geometry.ts';
