function isWindowsDrive(segment: string): boolean {
    return /^[A-Za-z]:$/.test(segment);
}

/* An absolute path, POSIX, with a Windows drive or UNC, as the `file:` URI a language server names it by. */
export function pathToFileUri(path: string): string {
    // A backslash separates only in a Windows path; in a POSIX one it is part of a name.
    const windows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
    const normalized = windows ? path.replaceAll('\\', '/') : path;
    if (windows && normalized.startsWith('//')) {
        const [host = '', ...segments] = normalized.slice(2).split('/');
        return `file://${encodeURIComponent(host)}/${segments.map(encodeURIComponent).join('/')}`;
    }
    const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const segments = rooted.split('/').map((segment, index) => (index === 1 && isWindowsDrive(segment) ? segment : encodeURIComponent(segment)));
    return `file://${segments.join('/')}`;
}

/* The path behind a `file:` URI, in the form of the machine it names, or null for any other kind of URI or one that does not decode. */
export function fileUriToPath(uri: string): string | null {
    let url: URL;
    let path: string;
    try {
        url = new URL(uri);
        path = decodeURIComponent(url.pathname);
    } catch {
        return null;
    }
    if (url.protocol !== 'file:') {
        return null;
    }
    // A server in the URI names a UNC share, which only Windows reads as a path.
    if (url.hostname !== '' && url.hostname !== 'localhost') {
        return `\\\\${url.hostname}${path.replaceAll('/', '\\')}`;
    }
    if (/^\/[A-Za-z]:/.test(path)) {
        return path.slice(1).replaceAll('/', '\\');
    }
    return path;
}
