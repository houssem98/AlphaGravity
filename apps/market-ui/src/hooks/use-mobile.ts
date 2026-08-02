import * as React from "react"

const MOBILE_BREAKPOINT = 768

// MB-4: the breakpoint is now a parameter, because `md` is the right hinge for
// a page whose layout merely reflows and the wrong one for a page that must fit
// fixed furniture. /trading's three columns reserve 288 + 300 = 588px of side
// panel, so at an 810px iPad the chart got 222px — measured at 16px in practice.
// That layout needs ~1024px before it is honest, not 768.
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < breakpoint)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return !!isMobile
}
