# Lazy loading

Components loaded on first use, and a prefetcher that loads them ahead of that once the app is idle.

```tsx
import { LazyBoundary, lazyDialog, lazyNamed, onLazyOpenError, prefetcher } from '@adecore/ui';
```

<Demo src="utilities/lazy-loading" />

## lazyNamed

`lazyNamed(load, name)` is `React.lazy` for a module that exports its component by name, `default` included. It returns a component with the same props, which suspends until the module is there and then draws straight away. Plain `React.lazy` suspends for a tick even on a module that is already loaded, which flashes the fallback and would mount a dialog already open.

```tsx
const HistoryPanel = lazyNamed(() => import('./HistoryPanel'), 'HistoryPanel');
```

What it returns is a `LazyComponent`: a component with `preload()`, which loads the module ahead of the first render, so that render draws straight away and never shows the fallback. Hand it to the prefetcher to load one surface first, such as the screen a person is about to open.

```tsx
void prefetcher.prefetch(HistoryPanel.preload);
```

## LazyBoundary

`LazyBoundary` is `Suspense` for what `lazyNamed` loads, with the same `fallback` (`LazyBoundaryProps`). React holds content that arrives as a retry back until 300 ms after its fallback showed, so a module that loads in 20 ms would still show its fallback for 300 ms. A `LazyBoundary` draws again as an ordinary update the moment a module lands, and the content shows when its module is here.

```tsx
<LazyBoundary fallback={<PanelSkeleton />}>
    <HistoryPanel />
</LazyBoundary>
```

## lazyDialog

`lazyDialog(load, name, useStore, isOpen)` is for a dialog that keeps its own open state in a store. Before its module is here, opening it loads it. Once it is here, prefetched or opened, it stays mounted while closed, so even its first opening animates like every later one.

```tsx
const SettingsWindow = lazyDialog(() => import('./SettingsWindow'), 'SettingsWindow', useAppStore, (state) => state.settingsOpen);
```

## The prefetcher

Every module loaded through `lazyNamed` or `lazyDialog` registers with `prefetcher`. Call `prefetcher.prefetchEverything()` once the app has drawn its first screen, and it loads every registered module ahead of its first use, one per idle moment and never two at once. A module registered afterwards, such as a lazy surface inside another, joins the end of the queue. `prefetcher.prefetch(load)` loads one module ahead of the rest.

The prefetcher does nothing while the browser asks to save data. A failed prefetch is quiet; the first real use tries again. `prefetcher.busy` is true while a prefetch waits on its chunk, so a failure an app hears of elsewhere, such as the bundler's event for a chunk that did not load, may be the prefetch's while it is true. It may also be a person's open at the same moment, which `onLazyOpenError` tells apart.

`WhenIdle` is a function that calls back once the main thread is free, and `Loader` is a function that loads a module.

## A failed open

`onLazyOpenError(listener)` calls `listener` with the error when a module that `lazyNamed` or `lazyDialog` loads for a render fails to load, which is a load a person waits on. A failed prefetch never reaches it, not even one of the same module that fails at the same moment. It returns a function that stops listening.

`React.lazy` keeps a rejected load, so the surface that failed stays down until the page loads again. That makes this the place to reload once after a deploy removed the chunks of the build the page runs.

```tsx
const stop = onLazyOpenError((error) => console.warn('A lazy surface failed to load', error));
```

## LoadedComponent

`LoadedComponent` is the cache both helpers share: a loader, the component once it is loaded (`current`), `load()` and `subscribe(listener)`. You rarely need it directly.
