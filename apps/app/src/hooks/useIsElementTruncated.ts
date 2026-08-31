import { useLayoutEffect, useState, type RefObject } from "react";

interface UseIsElementTruncatedArgs {
  elementRef: RefObject<HTMLElement | null>;
  measurementKey: string;
}

export function useIsElementTruncated({
  elementRef,
  measurementKey,
}: UseIsElementTruncatedArgs): boolean {
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
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
  }, [elementRef, measurementKey]);

  return isTruncated;
}
