import React, { useEffect, useRef } from 'react';

import { MonacoLanguagesLike, registerMacroHover } from './macroHover';

interface MonacoLike {
  editor?: {
    getEditors?: () => Array<{
      getContainerDomNode: () => HTMLElement;
      layout: () => void;
      getLayoutInfo: () => { width: number; height: number };
      getModel?: () => { getLanguageId: () => string } | null;
    }>;
  };
  languages?: MonacoLanguagesLike;
}

// Monaco's `automaticLayout` loses the initial-mount race in a flex container and
// leaves the editor at a ~5px sliver. SQLEditor hides its instance, so lay it out via
// Monaco's global registry — and, once found, register the macro hover against its
// language id (SQLEditor mints one per editor; plugin-ui offers no hover hook).
export function useMonacoAutoLayout<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    let hover: { dispose: () => void } | undefined;
    // Re-query each call (Monaco may dispose/recreate the editor on re-render).
    const layoutContained = () => {
      const monaco = (window as unknown as { monaco?: MonacoLike }).monaco;
      const editors = monaco?.editor?.getEditors?.().filter((e) => el.contains(e.getContainerDomNode())) ?? [];
      editors.forEach((e) => e.layout());
      if (!hover && monaco?.languages) {
        const languageId = editors[0]?.getModel?.()?.getLanguageId();
        if (languageId) {
          hover = registerMacroHover(monaco.languages, languageId);
        }
      }
      return editors;
    };
    // Poll (bounded) until the editor has mounted and actually fills the
    // container — not just settled at some width, which could be the sliver.
    let timer = 0;
    let attempts = 0;
    let lastWidth = -1;
    const poll = () => {
      const width = layoutContained()[0]?.getLayoutInfo().width ?? -1;
      const filled = width >= 0 && width === lastWidth && (el.clientWidth === 0 || width >= el.clientWidth / 2);
      lastWidth = width;
      if (!filled && attempts++ < 100) {
        timer = window.setTimeout(poll, 100);
      }
    };
    poll();
    // Keep it sized as the panel/window resizes.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layoutContained()) : undefined;
    resizeObserver?.observe(el);
    return () => {
      window.clearTimeout(timer);
      resizeObserver?.disconnect();
      hover?.dispose();
    };
  }, []);
  return ref;
}
