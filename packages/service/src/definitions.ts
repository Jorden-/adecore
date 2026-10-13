export interface ServiceSpec {
    label: string;
    description: string;
    program: string;
    args: string[];
    environment: Record<string, string>;
    workingDirectory: string;
    /* launchd only: where stdout and stderr go. systemd has the journal. */
    logFile: string;
}

function xmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plistString(value: string, indent: string): string {
    return `${indent}<string>${xmlText(value)}</string>`;
}

/*
 * `ProcessType=Interactive` avoids launchd throttling during a handover to a background process.
 */
export function launchAgentPlist(spec: ServiceSpec): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '    <key>Label</key>',
        plistString(spec.label, '    '),
        '    <key>ProgramArguments</key>',
        '    <array>',
        ...[spec.program, ...spec.args].map((arg) => plistString(arg, '        ')),
        '    </array>',
        '    <key>EnvironmentVariables</key>',
        '    <dict>'
    ];
    for (const [name, value] of Object.entries(spec.environment)) {
        lines.push(`        <key>${xmlText(name)}</key>`, plistString(value, '        '));
    }
    lines.push(
        '    </dict>',
        '    <key>WorkingDirectory</key>',
        plistString(spec.workingDirectory, '    '),
        '    <key>RunAtLoad</key>',
        '    <true/>',
        '    <key>KeepAlive</key>',
        '    <true/>',
        '    <key>ProcessType</key>',
        '    <string>Interactive</string>',
        '    <key>StandardOutPath</key>',
        plistString(spec.logFile, '    '),
        '    <key>StandardErrorPath</key>',
        plistString(spec.logFile, '    '),
        '</dict>',
        '</plist>',
        ''
    );
    return lines.join('\n');
}

/* systemd expands `%` specifiers everywhere and `$` variables in a command line, so both are doubled; quotes keep a space in a path. */
function unitWord(value: string, command: boolean): string {
    let escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
    if (command) {
        escaped = escaped.replace(/\$/g, '$$$$');
    }
    return `"${escaped}"`;
}

/*
 * User services stop at logout unless the caller explicitly enables lingering.
 */
export function systemdUnit(spec: ServiceSpec): string {
    const lines = [
        '[Unit]',
        `Description=${spec.description.replace(/%/g, '%%')}`,
        '',
        '[Service]',
        'Type=simple',
        `ExecStart=${[spec.program, ...spec.args].map((word) => unitWord(word, true)).join(' ')}`,
        ...Object.entries(spec.environment).map(([name, value]) => `Environment=${unitWord(`${name}=${value}`, false)}`),
        // The one setting here that takes no quotes: it reads the rest of the line as the path.
        `WorkingDirectory=${spec.workingDirectory.replace(/%/g, '%%')}`,
        'Restart=always',
        'RestartSec=2',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
    ];
    return lines.join('\n');
}

/* Only keys of the outer plist dictionary identify the executable; nested environment keys are data. */
function launchAgentProgram(definition: string): string | null {
    const xml = definition.replace(/<!--[\s\S]*?-->/g, '');
    if (xml.includes('<!--')) {
        return null;
    }
    const entries = new Map<string, string>();
    let depth = 0;
    let key: string | null = null;
    let start = 0;
    for (const token of xml.matchAll(/<(\/?)(dict|array)\s*>|<key>([^<]*)<\/key>/g)) {
        if (token[3] !== undefined) {
            if (depth !== 1) {
                continue;
            }
            if (key !== null) {
                entries.set(key, xml.slice(start, token.index));
            }
            key = token[3];
            if (entries.has(key)) {
                return null;
            }
            start = token.index + token[0].length;
        } else if (token[1] === '') {
            depth++;
        } else {
            depth--;
            if (depth === 0) {
                if (key !== null) {
                    entries.set(key, xml.slice(start, token.index));
                }
                const program = entries.get('Program');
                return program !== undefined
                    ? (/^\s*<string>([^<]*)<\/string>\s*$/.exec(program)?.[1] ?? null)
                    : (/^\s*<array>\s*<string>([^<]*)<\/string>/.exec(entries.get('ProgramArguments') ?? '')?.[1] ?? null);
            }
        }
    }
    return null;
}

function systemdRunsProgram(definition: string, program: string): boolean {
    let service = false;
    let commands: string[] = [];
    for (const raw of definition.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('#') || line.startsWith(';')) {
            continue;
        }
        if (/^\[.*\]$/.test(line)) {
            service = line === '[Service]';
            continue;
        }
        const command = service ? /^ExecStart\s*=\s*(.*)$/.exec(line)?.[1] : undefined;
        if (command !== undefined) {
            if (command === '') {
                commands = [];
            } else {
                commands.push(command);
            }
        }
    }
    const executable = unitWord(program, true);
    return commands.length > 0 && commands.every((command) => command === executable || command.startsWith(`${executable} `));
}

/*
 * Callers sharing a service identity can check executable ownership before replacing its definition.
 */
export function definitionRunsProgram(definition: string, program: string): boolean {
    return definition.trimStart().startsWith('<') ? launchAgentProgram(definition) === xmlText(program) : systemdRunsProgram(definition, program);
}
