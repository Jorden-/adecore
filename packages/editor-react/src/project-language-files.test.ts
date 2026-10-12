import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import type { CreatedFile, DeletedFile, WorkspaceEdit } from '@adecore/lsp';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService } from './testing.ts';

const edit: WorkspaceEdit = { documentChanges: [] };

describe('file operations of a project', () => {
    test('asks the servers with file URIs, a bare path being a file', async () => {
        const asked: Array<[string, readonly (CreatedFile | DeletedFile)[]]> = [];
        const service = Object.assign(new FakeLanguageService(), {
            willCreateFiles: async (files: readonly CreatedFile[]) => (asked.push(['willCreate', files]), edit),
            didCreateFiles: async (files: readonly CreatedFile[]) => void asked.push(['didCreate', files]),
            willDeleteFiles: async (files: readonly DeletedFile[]) => (asked.push(['willDelete', files]), null),
            didDeleteFiles: async (files: readonly DeletedFile[]) => void asked.push(['didDelete', files])
        });
        const project = new ProjectLanguage(service);
        expect(await project.willCreateFiles(['/work/My Files/a.ts', { path: '/work/dir', directory: true }])).toBe(edit);
        await project.didCreateFiles(['/work/a.ts']);
        expect(await project.willDeleteFiles([{ path: '/work/dir', directory: true }])).toBeNull();
        await project.didDeleteFiles(['/work/a.ts']);
        expect(asked).toEqual([
            [
                'willCreate',
                [
                    { uri: 'file:///work/My%20Files/a.ts', directory: false },
                    { uri: 'file:///work/dir', directory: true }
                ]
            ],
            ['didCreate', [{ uri: 'file:///work/a.ts', directory: false }]],
            ['willDelete', [{ uri: 'file:///work/dir', directory: true }]],
            ['didDelete', [{ uri: 'file:///work/a.ts', directory: false }]]
        ]);
    });

    test('has nothing to say when the service predates file operations', async () => {
        const project = new ProjectLanguage(new FakeLanguageService());
        expect(await project.willCreateFiles(['/work/a.ts'])).toBeNull();
        expect(await project.willDeleteFiles(['/work/a.ts'])).toBeNull();
        await project.didCreateFiles(['/work/a.ts']);
        await project.didDeleteFiles(['/work/a.ts']);
    });
});
