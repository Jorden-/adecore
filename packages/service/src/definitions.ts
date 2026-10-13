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

/* What a launch agent starts: its `Program`, which launchd prefers, or else the first of its `ProgramArguments`. */
function launchAgentProgram(definition: string): string | null {
    const match =
        /<key>Program<\/key>\s*<string>([^<]*)<\/string>/.exec(definition) ??
        /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(definition);
    return match?.[1] ?? null;
}

/*
 * Callers sharing a service identity can check executable ownership before replacing its definition.
 */
export function definitionRunsProgram(definition: string, program: string): boolean {
    return (
        launchAgentProgram(definition) === xmlText(program) ||
        definition.includes(`ExecStart=${unitWord(program, true)} `) ||
        definition.includes(`ExecStart=${unitWord(program, true)}\n`)
    );
}
