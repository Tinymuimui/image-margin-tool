import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled application error', error, info);
  }

  public render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-shell">
        <section className="panel fatal-error" role="alert">
          <h1>{'\u4e88\u671f\u3057\u306a\u3044\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f'}</h1>
          <p>{'\u753b\u9762\u304c\u771f\u3063\u767d\u306b\u306a\u308b\u4ee3\u308f\u308a\u306b\u3001\u3053\u306e\u5fa9\u65e7\u753b\u9762\u3092\u8868\u793a\u3057\u307e\u3059\u3002'}</p>
          <pre>{this.state.error.message}</pre>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            {'\u518d\u8aad\u307f\u8fbc\u307f'}
          </button>
        </section>
      </main>
    );
  }
}
