import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export function usePersistentLocalState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initialValue
      return JSON.parse(raw) as T
    } catch {
      return initialValue
    }
  })

  const setPersistentValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setValue((current) => {
      return typeof next === 'function' ? (next as (value: T) => T)(current) : next
    })
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* keep in-memory state even if storage quota/private mode blocks persistence */
    }
  }, [key, value])

  return [value, setPersistentValue]
}
