import { Component } from 'react';
import { Button } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';

// A friendly "that did not work" with a way forward.
export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', compact = false }) {
  return (
    <div className={`error-state${compact ? ' compact' : ''}`} role="alert">
      <WarningOutlined className="error-state-icon" />
      <div>
        <b>{title}</b>
        {message && <p>{message}</p>}
        {onRetry && <Button icon={<ReloadOutlined />} onClick={onRetry}>{retryLabel}</Button>}
      </div>
    </div>
  );
}

// Catches a screen that crashes (or whose code could not be downloaded, e.g. right after an update) so the rest of the app stays usable.
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) { console.error(error); }

  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(String(error?.message));
    return (
      <ErrorState
        title={chunk ? 'This screen could not be loaded' : 'This screen hit a problem'}
        message={chunk ? 'The app may have been updated or the connection dropped. Reload the page to continue.' : 'Your data is safe. Try again, or reload the page if it keeps happening.'}
        onRetry={chunk ? () => window.location.reload() : () => this.setState({ error: null })}
        retryLabel={chunk ? 'Reload page' : 'Try again'}
      />
    );
  }
}
