import type { Diagnostic, LanguageService } from '@adecore/lsp';
import { comparePositions, problemCountsOf, severityOf } from './diagnostics-model.ts';
import type { ProblemCounts } from './diagnostics.ts';

/* One problem of a file and the server that reported it. */
export interface ProblemRow {
    readonly diagnostic: Diagnostic;
    readonly server: string;
}

/* A file with problems; its path is a stored path (relative to the project folder, absolute outside it). */
export interface ProblemFile {
    readonly path: string;
    readonly rows: readonly ProblemRow[];
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2, hint: 3 } as const;

/* Worst first, then in the order of the file. */
export function compareRows(left: ProblemRow, right: ProblemRow): number {
    return (
        SEVERITY_ORDER[severityOf(left.diagnostic)] - SEVERITY_ORDER[severityOf(right.diagnostic)] ||
        comparePositions(left.diagnostic.range.start, right.diagnostic.range.start)
    );
}

/* One report of a file's problems; `path` is a stored path, as `ProblemFile.path` is. */
export interface ProblemReport {
    readonly path: string;
    readonly server: string;
    readonly diagnostics: readonly Diagnostic[];
}

/* Hands every report to `listener` until the function it returns runs. */
export type ProblemSource = (listener: (report: ProblemReport) => void) => () => void;

/* The diagnostics a service reports, by the stored path `pathOf` gives each URI. */
export function serviceProblems(service: LanguageService, pathOf: (uri: string) => string = (uri) => uri): ProblemSource {
    return (listener) => {
        const subscription = service.onDiagnostics((report) => listener({ path: pathOf(report.uri), server: report.source, diagnostics: report.diagnostics }));
        return () => subscription.dispose();
    };
}

/*
 * Each report replaces the previous diagnostics from that source for the file. Files with no
 * remaining problems drop out. Hints remain editor annotations rather than listed problems.
 */
export class ProjectProblems {
    private readonly reports = new Map<string, Map<string, readonly Diagnostic[]>>();
    private readonly files = new Map<string, ProblemFile>();
    private readonly listeners = new Set<() => void>();
    private readonly stop: () => void;
    /* The paths of `files` in order; null once a file came or went. */
    private order: string[] | null = [];
    /* Made on first read after a report, so a project nobody lists does no sorting. */
    private snapshot: readonly ProblemFile[] | null = [];

    /* A service stands for `serviceProblems(service, pathOf)`. */
    constructor(source: ProblemSource | LanguageService, pathOf?: (uri: string) => string) {
        const listen = typeof source === 'function' ? source : serviceProblems(source, pathOf);
        this.stop = listen((report) => this.report(report.path, report.server, report.diagnostics));
    }

    report(path: string, server: string, diagnostics: readonly Diagnostic[]): void {
        const kept = diagnostics.filter((diagnostic) => severityOf(diagnostic) !== 'hint');
        const servers = this.reports.get(path) ?? new Map<string, readonly Diagnostic[]>();
        if (kept.length === 0 && !servers.has(server)) {
            // A clean file reported clean again, as servers do after every edit.
            return;
        }
        if (kept.length === 0) {
            servers.delete(server);
        } else {
            servers.set(server, kept);
        }
        if (servers.size === 0) {
            this.reports.delete(path);
            this.files.delete(path);
            this.order = null;
        } else {
            if (!this.files.has(path)) {
                this.order = null;
            }
            this.reports.set(path, servers);
            const rows = [...servers].flatMap(([name, list]) => list.map((diagnostic): ProblemRow => ({ diagnostic, server: name }))).sort(compareRows);
            this.files.set(path, { path, rows });
        }
        this.snapshot = null;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }

    /* The same array until the next report, which is what a store a component reads must hand out. */
    getSnapshot = (): readonly ProblemFile[] => {
        if (this.snapshot === null) {
            this.order ??= [...this.files.keys()].sort((left, right) => left.localeCompare(right));
            this.snapshot = this.order.map((path) => this.files.get(path)!);
        }
        return this.snapshot;
    };

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    dispose(): void {
        this.stop();
        this.listeners.clear();
    }
}

export function countsOf(files: readonly ProblemFile[]): ProblemCounts {
    return problemCountsOf(files.flatMap((file) => file.rows.map((row) => row.diagnostic)));
}
