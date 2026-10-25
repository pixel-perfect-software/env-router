import { useEffect, useState } from 'react'

/** `value`, but only once it has held still for `ms`: a live region fed this announces where typing stopped, not every keystroke on the way. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
