# Syntax

A block is XML-like tags inside a fenced code block. This page is the grammar: the fence, declarations, tags, props, text and what happens to text that is still arriving.

## The fence

````md
The build is green.

```ui
<Summary tone="success">All 42 tests passed</Summary>
```

Want the slow ones?
````

A fence opens with three or more backticks or tildes, at most three spaces in, followed by the fence language and nothing else. It closes with the same character, at least as many times, and nothing after it. The language is `ui` unless the host [chose another](/intelligent-ui/guide/getting-started#tell-the-agent). A UI fence inside another code fence is code, not a block. A fence that is not closed yet is a block still streaming. Prose outside the fences stays Markdown.

## Declarations

```ui
$selected = ["links", "preload"]
$limit = 20
$filters = {
  "failed": true,
  "branch": "main"
}
<Summary>Showing {$limit} runs</Summary>
```

Declarations come first, one per line, before the first tag. A name starts with `$`, then a letter or an underscore. The value is literal JSON: a string, a number, a boolean, `null`, an array or a record. It may span lines while a bracket is open. A value that is not a literal is refused with `invalid_default`, and a second declaration of one name with `duplicate_declaration`.

The one other declaration is a live query, `$runs = @Query("ci.runs", {branch: "main"})`. See [Live queries](/intelligent-ui/host/queries).

## Tags

```ui
<Callout tone="warning" title="Flaky">The login test failed twice.</Callout>
<Stats><Stat label="Tests" value={42}/></Stats>
```

A tag is `<Name props>children</Name>`, or `<Name props/>` without children. A name starts with a letter and holds letters and digits. A closing tag closes the nearest open tag of its name and everything opened inside it; those inner tags get `unclosed_tag`. A closing tag with no open tag of its name gets `unmatched_tag`.

Some components belong inside another: a `Stat` inside `Stats`, an `Item` inside `Checklist`. A child outside its parent gets `invalid_parent`, and a container refuses a child it does not hold with `invalid_child`. `Show` and `Each` may stand anywhere and pass their parent on, so an `Each` inside a `Checklist` may repeat `Item`s. Each component page lists its rule.

## Props

```ui
<Stats><Stat label="Coverage" value={87.5} unit="%" tone="success"/></Stats>
<Choices><Choice primary={true} context='Run the "slow" suite'>Run it</Choice></Choices>
```

A prop is `name="text"`, `name='text'` or `name={expression}`. A name on its own is `true`, as in JSX: `<Choice primary>` reads as `primary={true}`. Quote strings. Put numbers, booleans, arrays, records and expressions in braces. Inside quotes a backslash escapes as in JSON: `\"`, `\'`, `\\`, `\/`, `\n`, `\t`, `\r`, `\b`, `\f` and `\uXXXX`.

A braced value that is a constant becomes a static prop. Anything that reads a variable stays an expression, evaluated against state when the block draws. The compiler checks every prop against the component's schema once it can: at once for constants, and for expressions with the defaults of the block.

A prop the component does not have is dropped with `refused_prop`, and the rest of the node still draws. A prop written twice gets `duplicate_prop`. A value that fails the schema marks the node `invalid_props`, and the node draws as its fallback.

## Text

```ui
$found = ["links", "preload", "cache"]
$fixed = ["links"]
<Summary>Fixed {@Count($fixed)} of {@Count($found)} findings</Summary>
```

Text between tags is a text node. A `{expression}` inside text is evaluated and written as text; it must give a string, a number, a boolean or `null`. Whitespace that holds a line break and nothing else is dropped, so tags may stand on lines of their own. A renderer writes text as inline Markdown at most; [agents-react](/agents-react/chat/intelligent-ui) allows emphasis, inline code and links.

## CodeBlock

```ui
<CodeBlock language="ts">
const empty = <T,>(items: T[]) => items.length === 0 && {} !== null;
</CodeBlock>
```

Everything between `<CodeBlock>` and `</CodeBlock>` is literal text: angle brackets, braces and `$` included. A CodeBlock cannot hold another tag, and its contents are never evaluated.

## While it streams

The compiler runs on every preview of a reply, so it reads text that stops anywhere.

- A tag that is still open is an incomplete node. Its renderer draws what it has. A control is not interactive until its tag closes.
- A quoted prop that has not closed yet holds the text received so far.
- A half-written prop, name or expression waits for more text without a diagnosis.
- A prop that cannot be read is reported and skipped up to the next space or the end of its tag. The tag still opens and closes, and its children and neighbors still draw; the node itself draws as its text fallback. A tag that lost a prop and is never closed ends at its own `>`.
- After other malformed input the parser reports it and goes on at the next tag or line, so one mistake costs one line.
- An unknown component keeps its own text fallback, and its neighbors still draw.

Once the reply is final, anything still open is reported: `unclosed_tag` for a tag, `incomplete_expression` for an expression.

## Diagnostics

Every problem becomes a `UiDiagnostic` with a `code`, a `message`, a source range and, where it has one, the node's id. A block keeps at most `UI_LIMITS.diagnostics` of them.

| Code                                         | Cause                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| `invalid_syntax`, `invalid_tag`, `invalid_prop` | A character where a tag, a prop name or a value was expected |
| `invalid_declaration`, `duplicate_declaration`, `invalid_default` | A declaration that is malformed, repeated or not a literal |
| `unclosed_tag`, `unmatched_tag`              | Tags that do not pair                                        |
| `duplicate_prop`, `refused_prop`, `invalid_props` | A prop written twice, unknown, or failing its schema    |
| `too_many_series`                            | A Chart with more numeric series than a drawing holds; the rest stay in its values |
| `unknown_component`                          | A name outside the catalog                                   |
| `invalid_parent`, `invalid_child`            | A component in the wrong place                               |
| `invalid_expression`, `incomplete_expression`, `invalid_value` | An expression that does not parse or evaluate |
| `refused_call`, `refused_access`             | An unknown helper, or a forbidden or inherited field         |
| `query_only`, `action_only`                  | `@Query` outside a declaration, or `@Set`/`@Reset` as a value |
| `invalid_query`, `unknown_query`             | A query the host did not register or does not accept         |
| `refused_action`, `refused_binding`          | A Button action or a binding on something other than local state |
| `budget_exceeded`                            | The block or the reply ran out of budget                     |
