# Choices

Optional next steps after a finished answer. Information or a decision the agent needs before it acts is not a Choice: the agent asks with its own question tool when it has one, and otherwise in prose. A Choice sends its label and its context as a message, once, after the reply finished streaming. See [Choices](/intelligent-ui/host/choices) for what the host checks.

<Demo src="intelligent-ui/choices" />

```ui
<Summary>Two ways to fix the flaky test</Summary>
<Choices>
<Choice primary={true} context="Wait for the login request before asserting.">Wait for the request</Choice>
<Choice context="Raise the timeout of the login step to ten seconds.">Raise the timeout</Choice>
<Choice disabled={true}>Skip the test</Choice>
</Choices>
```

## Choices and Choice

`Choices` has no props and holds only `Choice`. A `Choice` stands only inside `Choices`; its children are the label.

| Prop       | Type    | Required | Notes                                                                 |
| ---------- | ------- | -------- | --------------------------------------------------------------------- |
| `context`  | string  | No       | The message it sends, shown under the label; the label without one   |
| `primary`  | boolean | No       | The recommended step; it stands first                                 |
| `disabled` | boolean | No       | Shown, but cannot be picked                                           |

Write a short label and a precise context. The context is the agent's next prompt, so it should say what to do without the block beside it. Both are visible before a person picks.

The label and the context may read state. The message is evaluated with the values on screen when the person picks:

```ui
$scope = "failed"
<Segmented value={$scope}>
<Option value="failed">Failed only</Option>
<Option value="all">Everything</Option>
</Segmented>
<Choices>
<Choice context={"Rerun the " + $scope + " tests on main."}>Rerun</Choice>
</Choices>
```

A block is answered once. After a pick, every Choice and every input of the block closes, and the block says which Choice answered and when.
