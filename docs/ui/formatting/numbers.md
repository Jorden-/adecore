# Numbers

Counts, decimals, percentages, money, sizes and token counts, each in the notation of the region. The examples are in an English region; a Dutch one swaps the separators.

```ts
import { formatBytes, formatDecimal, formatMoney, formatNumber, formatNumeral, formatPercent, formatRounded, formatTokens, formatUsdSignificant } from '@adecore/ui/format';
```

<Demo src="formatting/numbers" />

| Function | Writes |
| --- | --- |
| `formatNumber(value)` | A whole number, grouped the way the region groups one: `1,234,568` or `1.234.568`. It rounds first. |
| `formatDecimal(value)` | The same with at most one decimal, where the fraction is the part that means something. |
| `formatRounded(value, decimals)` | At most `decimals` places with trailing zeros dropped, for a total or an average: `39`, `1.95`. |
| `formatNumeral(numeral)` | A numeral as a database writes it, a number or text such as `9007199254740993` or `-0.50`, in the region's notation with every digit and the decimals it was written with. Text that is no plain numeral comes back as it is. |
| `formatPercent(value)` | A percentage of a value that is already a percent: one decimal under ten, where the difference still shows, and whole above. `4.3%`, `43%`. |
| `formatMoney(value, currency, maximumFractionDigits?)` | An amount in the currency it is already in, with the narrow symbol, so a Dutch region writes `$ 5.480,96` and not `US$ 5.480,96`. `currency` is an ISO code such as `USD`. |
| `formatUsdSignificant(value)` | Dollars to three significant digits, for a list of amounts that runs from a fraction of a cent to tens of dollars. |
| `formatTokens(value)` | A token count read as a size rather than counted: `1.2M`, `412K`, `640`. |
| `formatBytes(bytes, whole?)` | A file size in B, KB, MB, GB or TB: `1.5 KB`. One decimal under ten, from a kilobyte up. `whole` rounds, for a column with no room for a decimal. |

None of these converts. `formatMoney` never changes the currency, and `formatBytes` counts in steps of 1024.
