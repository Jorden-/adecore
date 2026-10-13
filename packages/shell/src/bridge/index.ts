/*
 * The shapes that cross IPC between the shell and the page it hosts. Nothing here imports Electron, so
 * a preload and a page read them as well as the main process.
 */

export { MENU_ROLES, type MenuNode, type MenuRole, type MenuSpec } from './menu.ts';
export type { ThemeState } from './theme.ts';
export type { UpdateErrorCode, UpdateState } from './update.ts';
export { compareVersions, isVersion } from './versions.ts';
