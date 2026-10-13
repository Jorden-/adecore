import { fakeCodex } from '../fake-codex.ts';
import { runOverStdio } from '../fake-cli.ts';

// Run as a script, it stands in for `codex app-server` behind real pipes; imported, it does nothing.
if (import.meta.main) {
    await runOverStdio(fakeCodex);
}
