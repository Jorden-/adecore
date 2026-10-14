import { useEffect, useState } from 'react';

/*
 * Whether `element` is near the viewport, with `margin` to spare so it is ready by the time it scrolls in.
 * Without an observer (a server render, a test) it counts as in view.
 */
export function useInView(element: Element | null, margin = '200px'): boolean {
    const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
    useEffect(() => {
        if (element === null || typeof IntersectionObserver === 'undefined') {
            return;
        }
        const observer = new IntersectionObserver((entries) => setInView(entries.at(-1)?.isIntersecting ?? false), { rootMargin: margin });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, margin]);
    return inView;
}
