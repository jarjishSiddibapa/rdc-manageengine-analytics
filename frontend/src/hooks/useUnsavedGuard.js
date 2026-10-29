import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp } from 'antd';

// While `dirty` is true (a form has changes that are not saved):
//   - closing or reloading the tab asks first (the browser's own question),
//   - clicking any link inside the app (menu, breadcrumbs...) asks first, then goes on if the person confirms.
// Moving between tabs of the same page is guarded by the page itself with askToLeave().
export default function useUnsavedGuard(dirty) {
  const navigate = useNavigate();
  const { modal } = AntApp.useApp();

  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    const onClick = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target?.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      askToLeave(modal, () => navigate(url.pathname + url.search + url.hash));
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, modal, navigate]);
}

export function askToLeave(modal, proceed) {
  modal.confirm({
    title: 'Leave without saving?',
    content: 'You have changes that are not saved. If you leave now they are lost.',
    okText: 'Leave without saving',
    cancelText: 'Stay and keep editing',
    okButtonProps: { danger: true },
    onOk: proceed,
  });
}
