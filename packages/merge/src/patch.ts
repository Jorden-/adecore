/* Which side a patch says the file is missing on, read from its header so no line of the file can pass for it. */
export function missingSides(patch: string): { old: boolean; new: boolean } {
    const start = patch.search(/^@@/m);
    const header = start === -1 ? patch : patch.slice(0, start);
    return { old: /^--- \/dev\/null$/m.test(header), new: /^\+\+\+ \/dev\/null$/m.test(header) };
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/* Git's --ignore-all-space may show either side's spacing on a context line. */
export function patchFits(patch: string, oldText: string, newText: string, ignoreWhitespace: boolean): boolean {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const same = ignoreWhitespace
        ? (shown: string, actual: string | undefined): boolean => actual !== undefined && shown.replace(/\s+/g, '') === actual.replace(/\s+/g, '')
        : (shown: string, actual: string | undefined): boolean => shown === actual;
    let oldAt = -1;
    let newAt = -1;
    let hunks = 0;
    for (const line of patch.split('\n')) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            hunks += 1;
            oldAt = Number(header[1]) - (header[2] === '0' ? 0 : 1);
            newAt = Number(header[3]) - (header[4] === '0' ? 0 : 1);
            continue;
        }
        if (oldAt === -1) {
            continue;
        }
        const body = line.slice(1);
        if (line.startsWith(' ')) {
            if (!same(body, oldLines[oldAt]) || !same(body, newLines[newAt])) {
                return false;
            }
            oldAt += 1;
            newAt += 1;
        } else if (line.startsWith('-')) {
            if (!same(body, oldLines[oldAt])) {
                return false;
            }
            oldAt += 1;
        } else if (line.startsWith('+')) {
            if (!same(body, newLines[newAt])) {
                return false;
            }
            newAt += 1;
        }
    }
    return hunks > 0;
}
