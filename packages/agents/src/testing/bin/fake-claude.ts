import { fakeClaude } from '../fake-claude.ts';
import { runOverStdio } from '../fake-cli.ts';

// Run as a script, it stands in for the Claude CLI behind real pipes; imported, it does nothing.
if (import.meta.main) {
    await runOverStdio(fakeClaude);
}
