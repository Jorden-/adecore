import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from 'bun:test';
import { discoverPackages, repositoryRoot } from './workspaces.ts';

interface IssueForm {
    body: { id?: string; attributes: { options?: string[] } }[];
}

test.each(['bug.yml', 'request.yml'])('%s offers every package', (template) => {
    const form = Bun.YAML.parse(readFileSync(join(repositoryRoot, '.github/ISSUE_TEMPLATE', template), 'utf8')) as IssueForm;
    const options = form.body.find((field) => field.id === 'package')?.attributes.options;
    const packages = discoverPackages().map((pkg) => basename(pkg.directory));
    expect(options?.toSorted()).toEqual(packages.toSorted());
});
