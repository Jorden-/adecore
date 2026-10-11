import { Component, type ReactNode } from 'react';

interface Props {
    fallback: ReactNode;
    children: ReactNode;
    resetKeys: readonly unknown[];
}

interface State {
    failed: boolean;
    resetKeys: readonly unknown[];
}

/* A failed editor or lazy chunk must keep the file review available through the legacy renderer. */
export class DiffFallbackBoundary extends Component<Props, State> {
    state: State = { failed: false, resetKeys: this.props.resetKeys };

    static getDerivedStateFromError(): Partial<State> {
        return { failed: true };
    }

    static getDerivedStateFromProps(props: Props, state: State): State | null {
        if (state.resetKeys.length !== props.resetKeys.length || state.resetKeys.some((value, index) => !Object.is(value, props.resetKeys[index]))) {
            return { failed: false, resetKeys: props.resetKeys };
        }
        return null;
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
