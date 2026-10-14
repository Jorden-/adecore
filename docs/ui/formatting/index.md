# Format source

`@adecore/ui/format` writes every number, date, time and duration a person reads. It is the only place in the library that builds an `Intl` formatter, and your app can use it the same way.

```ts
import { formatNumber, formatDayClock, setFormatSource } from '@adecore/ui/format';
```

<Demo src="formatting/source" />

## Words and notation

Two settings decide what a value looks like, and they are separate on purpose. The language writes the words: the month, the weekday, "3 min ago". The region writes the notation: the order of day and month, the separators, and whether the clock counts to 12 or 24. An English interface on a Dutch computer is a real combination, and it reads `19 Sep, 08:05`.

Change the language and the region above and watch both halves move independently.

## The source

The formatters read both settings through a `FormatSource` your app hands over once, before the first render. `UIProvider` takes it as `formatSource`; without the provider, call `setFormatSource` yourself.

```ts
interface FormatSource {
    language(): string;
    region(): string;
    systemLocale?(): string | undefined;
    subscribe(onChange: () => void): () => void;
}
```

`language` returns the language the interface is written in, such as `en` or `nl`. `region` returns a region tag such as `nl-NL`, or `FORMAT_LANGUAGE` to use the region the language comes with, or `FORMAT_SYSTEM` to follow the operating system; see [Regions](/ui/formatting/regions). `systemLocale` is for a desktop shell that can read the operating system's own region; a browser leaves it out. `subscribe` calls back whenever either setting may have changed.

Without a source the formatters write English, in the system's region when that speaks English and in `en-US` otherwise. `setFormatSource` returns the source it replaced, so a test can put that one back.

## Drawing again on a change

A formatter is a plain function, so a component that calls one does not know the region changed. Call `useFormatLocale()` in it. It subscribes to the source and returns the current locale, which you may use or ignore. A component that calls it draws again when a person changes the language or the region.

```tsx
function LastSaved({ at }: { at: number }) {
    useFormatLocale();
    return <span>{formatMoment(at)}</span>;
}
```

`formatLocale()` returns the locale the notation is written in, resolved from the source, such as `en-US`. It is a plain function over the source, so code outside React can read it too.

## Sorting labels

`labelCollator()` returns an `Intl.Collator` for the language, to put labels a person reads in order. Labels are words, so the language sorts them, and Dutch and English can order the same two words differently.

```ts
names.sort(labelCollator().compare);
```

It compares without regard to case or accents and reads numbers inside a label as numbers, so `Tab 2` comes before `Tab 10`.

## Fallbacks

`systemLocale()` returns the operating system's locale: the source's `systemLocale` when it hands one over and `Intl` accepts it, then the browser's first language, then `en-US`. A test that must not depend on the machine it runs on sets a region explicitly, as the [fake source](/ui/utilities/testing) does.

## Cost

A formatter is cached on its options object, by identity, and its locale. The library's own options are module constants, so a list of a thousand rows builds nothing new. A region change rebuilds a formatter on its next use.

`FormatSource` is an exported type. [Testing](/ui/utilities/testing) has a fake source for tests.
