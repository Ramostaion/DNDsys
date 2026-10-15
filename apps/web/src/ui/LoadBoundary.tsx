import { Component, type ReactNode } from 'react';

export default class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="grid place-items-center p-5 subtle">
        界面暂时无法加载{' '}
        <button className="btn ml-2" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
