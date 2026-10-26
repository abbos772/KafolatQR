import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listMyStores, createStore } from '../api/stores'
import { useAuth } from './AuthContext'
import { StoreContext, type StoreContextValue } from './StoreContext'
import type { Store } from '../types/db'

const STORAGE_KEY = 'kafolatqr:selectedStoreId'

function readStoredStoreId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredStoreId(storeId: string | null): void {
  try {
    if (storeId === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, storeId)
  } catch {
    // Private browsing / storage disabled: selection simply is not persisted.
  }
}

/**
 * Holds the list of stores the caller owns and which one is active.
 *
 * The empty state for a signed-out user is *derived* rather than written by an
 * effect: calling setState synchronously inside an effect causes cascading
 * renders, and this way there is nothing to reset.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  const [stores, setStores] = useState<Store[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(() =>
    readStoredStoreId(),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // Signed out: derived as an empty list below, no state write needed.
    if (!user) return

    let active = true

    // All state updates happen AFTER the await, i.e. in an async callback rather
    // than synchronously inside the effect body.
    void (async () => {
      try {
        const next = await listMyStores()
        if (!active) return

        setStores(next)
        setSelectedStoreId((previous) => {
          const stored = previous ?? readStoredStoreId()
          if (stored && next.some((store) => store.id === stored)) return stored
          return next.length > 0 ? next[0].id : null
        })
        setError(null)
      } catch (err) {
        if (!active) return
        const message = err instanceof Error ? err.message : "Do'konlarni yuklab bo'lmadi."
        setError(message)
        setStores([])
        setSelectedStoreId(null)
      } finally {
        if (active) setLoading(false)
      }
    })()

    // Guards against setState after unmount or after the user/dep changes.
    return () => {
      active = false
    }
  }, [user, reloadKey])

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  const selectStore = useCallback((storeId: string) => {
    setSelectedStoreId(storeId)
    writeStoredStoreId(storeId)
  }, [])

  const createStoreAndSelect = useCallback(
    async (name: string) => {
      const created = await createStore(name)
      writeStoredStoreId(created.id)
      setSelectedStoreId(created.id)
      // Re-read so the new store joins the list under RLS. This is an async
      // event-handler continuation, not an effect, so it is safe to trigger here.
      reload()
      return created
    },
    [reload],
  )

  const value = useMemo<StoreContextValue>(() => {
    // Signed-out users see an empty list by derivation, not by a state write.
    const effectiveStores = user ? stores : []
    const effectiveLoading = user ? loading : false

    const currentStore =
      effectiveStores.find((store) => store.id === selectedStoreId) ?? null

    return {
      stores: effectiveStores,
      currentStore,
      currentStoreId: currentStore?.id ?? null,
      loading: effectiveLoading,
      error,
      selectStore,
      createStore: createStoreAndSelect,
      reload,
    }
  }, [
    user,
    stores,
    selectedStoreId,
    loading,
    error,
    selectStore,
    createStoreAndSelect,
    reload,
  ])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export default StoreProvider
