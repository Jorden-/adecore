# Live queries

A block can show data that changes after the agent wrote it: the state of a build, the open tasks of a project. The agent declares a query of a source the host registered. The host reads it with the access of the chat that wrote the block, and the page shows the newest reading while the block is in view.

```ui
$branch = "main"
$runs = @Query("ci.runs", {branch: $branch, limit: 5})
<Segmented value={$branch}>
<Option value="main">main</Option>
<Option value="release">release</Option>
</Segmented>
<Table rows={$runs}>
<Column key="name" title="Run"/>
<Column key="ms" title="Time" as="duration"/>
</Table>
```

## Declaring a query

`$name = @Query("source", {arguments})` is a declaration, at the top of the block. The rules:

- The source is a string literal, and the host must have registered it. An unknown source is `unknown_query`.
- The arguments are a record. They may read declared local state, so a control can change what is read. They never read a query result, so one query cannot steer another.
- The host's schema for the source must accept the arguments as evaluated with the defaults, or the block gets `invalid_query`.
- A block declares at most `UI_HOST_LIMITS.queries` (8) queries.
- A query is read only. Nothing in a block writes to a source.

The result is the value of `$name`. Until the first reading arrives it has none, and a part that reads it draws as its fallback.

## Registering sources

The compiler needs each source's argument schema: `UiCompileOptions.querySchemas` maps a source name to a zod schema. With [`@adecore/agents`](/agents/chats#live-ui-sources) the host passes a `ChatUiHost` as `ChatCoreOptions.intelligentUi`, and the sessions take the schemas from it:

```ts
import { z } from 'zod';
import type { ChatUiHost } from '@adecore/agents/chat';

const intelligentUi: ChatUiHost = {
    // Called once per reply that may read a source or name a link; the result stays on the backend.
    capture: async (info) => ({ projects: await projectsOf(info) }),
    sources: {
        'ci.runs': {
            args: z.strictObject({ branch: z.string(), limit: z.number().int().positive().optional() }),
            result: z.array(z.strictObject({ name: z.string(), ms: z.number() })),
            authorize: async (info, access, args) => assertCanRead(info, access, args),
            read: (info, args, signal) => fetchRuns(args, signal)
        }
    }
};
```

`capture`, `authorize` and `read` are yours; `projectsOf`, `assertCanRead` and `fetchRuns` stand for your own code. `capture` records what the writing chat may read, once per reply. `authorize` throws to refuse, and runs before every read with that captured access and the chat's current info. `read` returns the result, which must pass `result`.

To say why with a code a client can word itself, throw a `ChatUiRefusal(code, reason)` from `@adecore/agents/chat`, as in `throw new ChatUiRefusal('project-closed', 'The project is closed.')`. The code lands in the reading's `code` and the sentence in its `reason`: from `authorize` the reading is `refused`, from `read` it is `failed`, and from `ChatUiHost.link` the link stays plain. Keep a code the same across versions. Pick one of the host codes below when it fits, and otherwise one that is in neither table.

## Reading

A client asks `ui.query` with the block's identity, the query name and its current input values. The backend then:

1. Finds the stored, completed block at that `revision`. A block that changed answers `block-stale`.
2. Checks the query is declared there and its source registered.
3. Validates the input values with `uiValidatedState` and evaluates the arguments with `uiQueryArguments(block, name, input, limits?, queries?)`, against the stored definition, never against the client's. `queries` holds the newest fresh reading of each query of the block, so a value picked from options a query read passes; a choice passes the readings its `reads` name.
4. Parses the arguments with the source's schema and authorizes them with the captured access.
5. Answers from the cache if the same arguments were read in the last ten seconds, or reads.

`uiValidatedState(block, input, queries?, limits?)` accepts only values of declared inputs that a person could have set on screen; see [Choices](/intelligent-ui/host/choices#what-a-person-could-have-set). `uiQueryArguments` throws a `UiFailure` (`invalid_query`, `refused_binding`, `invalid_value`) for anything else.

A reading is a `ChatUiQueryReading`: `state` (`fresh`, `failed` or `refused`), the `value` and a `readId` when fresh, `readAt`, and for a failure a `reason` with a stable `code`.

## Limits

`UI_HOST_LIMITS` holds what a host reads per block. The agents host adds bounds of its own.

| Limit                         | Value  | Where                                     |
| ----------------------------- | ------ | ----------------------------------------- |
| Queries per block             | 8      | `UI_HOST_LIMITS.queries`                  |
| Link targets per block        | 64     | `UI_HOST_LIMITS.links`                    |
| One read per query and input  | 10 s   | `UI_HOST_LIMITS.refreshMilliseconds`      |
| A changed input reads after   | 250 ms | The agents host                           |
| Reads at once                 | 2 per chat, 16 in all | The agents host            |
| A read times out after        | 8 s    | The agents host; the source is aborted    |
| Result size                   | 64 KB  | The agents host                           |
| Captured access               | 32 KB  | The agents host                           |

A timed-out source keeps its slot until its work actually ends. The backend never reads on a clock of its own: only a visible block asks.

## Freshness

When a reply is final, the backend reads every query of every block once and freezes those first readings, the link resolutions and a text fallback in the item's `uiQueries`. A page draws the frozen readings at once, and a client that cannot read live still has them. `uiQueryFallback(block, values)` builds that text from the block evaluated with the first values, so the agent's own history keeps what the person saw.

The page reads again while a block is visible and the app is in front: at most every ten seconds, and once more when an input rested for 300 ms. A failed read keeps the last successful value, muted. Choices of a block stay closed while it reads, and send the read ids of the values on screen; see [Choices](/intelligent-ui/host/choices#live-blocks).

## Reason codes

A failed or refused reading, a plain link and a refused choice carry a `code` that stays the same across versions, beside a `reason` in words. A client words a code it knows itself and shows the reason for one it does not. `uiReasonText` in [agents-react](/agents-react/chat/intelligent-ui#words-and-accessibility) does this.

| Code                  | Meaning                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `block-stale`         | The block changed since the client drew it                       |
| `query-undeclared`    | The block does not declare that query                            |
| `source-unregistered` | The host has no such source                                      |
| `access-unavailable`  | The writing chat's captured access is missing                    |
| `refresh-limit`       | The same query and input were read less than ten seconds ago     |
| `busy`                | Too many reads are running                                       |
| `timed-out`           | The source took longer than eight seconds                        |
| `result-too-large`    | The result is over 64 KB                                         |
| `snapshot-too-large`  | The first readings were too large to freeze                      |
| `stale-read`          | A choice named a read the backend no longer holds for its inputs |
| `links-unsupported`   | The host resolves no links                                       |
| `link-unsupported`    | The node is not a visible link of the block                      |
| `link-unchecked`      | The link has to be checked again                                 |
| `unreadable`          | The page could not reach the backend                             |

Any other error your `authorize`, `read` or `link` throws carries its message as the reason and no code.

A host may also refuse with one of the codes that `uiReasonText` words without being in this table:

| Code                 | Meaning                                                      |
| -------------------- | ------------------------------------------------------------ |
| `outside-project`    | The source or target lies outside the writer's project       |
| `target-unavailable` | The file, commit, diff or node a link names is gone          |
| `no-unique-match`    | A name the source looks up matches nothing, or more than one |

## Places

A `Place` can give an address instead of coordinates. A host that registers `ChatUiHost.place` has each such address looked up once, when the reply settles, and the point is frozen beside the block in `uiQueries.blocks[id].places`, by node id. Every client then draws the same point, also months later, and a reader of the fallback finds the coordinates in its `Places:` line.

```ts
import { uiPlaceQueries } from '@adecore/intelligent-ui/places';

const intelligentUi: ChatUiHost = {
    capture: async () => null,
    sources: {},
    // One lookup of one address; `signal` aborts after five seconds.
    place: async (info, { address, name }, signal) => {
        const match = await geocode(address, signal);
        return match ? { state: 'found', lat: match.lat, lon: match.lon, label: match.label } : { state: 'missing', code: 'no-match' };
    }
};
```

`uiPlaceQueries(block, input?, queries?)` gives the complete Places with an address and no coordinates as `{ [nodeId]: { address, name } }`; the host itself calls `place` for at most `UI_HOST_LIMITS.places` (50) of them, one after the other. `uiMayReferenceHost` is true for text with a `<Place` that has `address=`, so the daemon looks at such a reply.

A reading is `found` with `lat`, `lon` and an optional `label`, or `missing` with an optional `code` and `reason`. A lookup that throws, takes longer than five seconds or answers something the schema refuses is frozen as `missing` with the reason, and nothing looks again: a machine that was offline or signed out when the reply settled keeps `missing` for that reply. A host without `place` freezes nothing, and the renderers draw such a place as not on the map. The write is dropped when the block changed while the lookups ran.

A frozen reading is the host's to keep or drop: a host that may not store coordinates leaves `place` out, and a map then draws only the places the agent gave coordinates for.
