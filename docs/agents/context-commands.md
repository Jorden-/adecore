# Context commands

A host can give its agents a command line to call back into it: to open another chat, hand over a task, read a document. The package has the parsing, the help and the refusals of such a command; it has no executable, server, socket or hook of its own. Your app decides how a call reaches it, checks who is calling, and hands each verb what it may touch.

```ts
import { createVerbRegistry, requiredField, VerbRefusal } from '@adecore/agents/context';
```

## A verb

A note verb over a write function of your app's own, with a dry run that checks everything and writes nothing:

```ts
import { z } from 'zod';
import { createVerbRegistry, requiredField, VerbRefusal, type VerbCallBase, refusalBody } from '@adecore/agents/context';

interface Call extends VerbCallBase {
    authorized: boolean;
    write(text: string, expectedRevision?: number): Promise<void>;
}

export const registry = createVerbRegistry<Call>({ cli: 'app-context' });
export const note = registry.defineVerb({
    name: 'note',
    usage: '--text T',
    summary: 'Writes a note to the active document',
    detail: ['flag\t--text T\trequired\tThe note text'],
    positionals: z.array(z.string()).max(0),
    flags: z.object({ text: requiredField('note needs --text') }),
    dryRun: true,
    revision: true,
    run: async ({ flags, dryRun }, call) => {
        if (!call.authorized) {
            throw new VerbRefusal('not-permitted', 'This caller may not write this document.');
        }
        if (!dryRun) {
            await call.write(flags.text, call.expectedRevision);
        }
        return [dryRun ? 'preview\tvalidated' : 'note\twritten'];
    }
});

export async function runNote(argv: readonly string[], call: Call): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
        return { exitCode: 0, stdout: (await note.run(argv, call)).join('\n'), stderr: '' };
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return { exitCode: 3, stdout: '', stderr: refusalBody(error.code, error.message, error.lines) };
        }
        throw error;
    }
}
```

`write` stands for your app's; when a revision was given, it has to check it in the same step as the write. The registry only parses the number and passes it on as `expectedRevision`.

## Arguments and help

A flag is `--name value` or `--name=value`; a value that starts with `--` needs the second form. A switch takes no value. Unknown, repeated and missing flags are refused before the verb runs, and then the positionals and flags go through their Zod schemas. `requiredField(message)` is a string flag that may not be missing or empty, `lengthOf` measures input for a message about its size, and `orNote(lines, note)` prints a note for an empty list.

`defineNoun` and `defineAction` group verbs under a noun. `defineHelp` writes the usage, detail and topics from the same definitions the dispatch uses, and `summaryLines` the short list.

Only a verb with `dryRun: true` takes `--dry-run`; any other refuses it with `no-dry-run`. The flag only reaches your `run` as `dryRun`: taking the branch that writes nothing is yours. A verb with `revision: true` takes `--revision N`.

## Refusals

`VerbRefusal(code, message, lines?)` is a refusal with advice. `refusalBody` writes it as `refused`, the code and the message on one line, tab separated, with an advice row per line after it; `refusalRows` leaves out the `refused`, for a command line that prints that itself. `parseRefusalBody` reads either back, or answers `null` for text that is no refusal. `field(value)` makes a value safe for one field, so a title with a tab in it cannot break a row. The helpers print nothing and exit nothing: exit code 3 above is the example's choice.
