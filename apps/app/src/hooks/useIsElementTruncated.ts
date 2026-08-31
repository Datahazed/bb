import { useCallback, useLayoutEffect, useState } from "react";

interface UseIsElementTruncatedArgs {
  measurementKey: string;
}

export function useIsElementTruncated({
  measurementKey,
}: UseIsElementTruncatedArgs): {
  elementRef: (element: HTMLElement | null) => void;
  isTruncated: boolean;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const elementRef = useCallback((nextElement: HTMLElement | null) => {
    setElement(nextElement);
  }, []);

  useLayoutEffect(() => {
    if (element === null) {
      setIsTruncated(false);
      return;
    }

    const measure = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth + 1);
    };
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [element, measurementKey]);

  return { elementRef, isTruncated };
}
