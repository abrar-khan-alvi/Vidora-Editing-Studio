import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const COMPACT_BREAKPOINT = 1024;

function useMaxWidth(breakpoint: number) {
  const [matches, setMatches] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setMatches(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setMatches(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!matches;
}

/** True below 768px — phones. */
export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT);
}

/**
 * True below 1024px — phones and tablets. The editor switches to its
 * compact layout here: side panels become overlay sheets and the
 * timeline gets a fixed height with a bottom toolbar.
 */
export function useIsCompact() {
  return useMaxWidth(COMPACT_BREAKPOINT);
}
