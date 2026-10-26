import { createContext, useContext } from 'react'
import type { Store } from '../types/db'

/**
 * Store-selection state shared with the UI.
 *
 * Deliberately free of React components so `react-refresh/only-export-components`
 * does not flag the provider file. `StoreProvider` lives in `./StoreProvider.tsx`.
 */

export interface StoreContextValue {
  stores: Store[]
  currentStore: Store | null
  currentStoreId: string | null
  loading: boolean
  error: string | null
  selectStore: (storeId: string) => void
  createStore: (name: string) => Promise<Store>
  /** Re-reads the store list. Call from event handlers, never from an effect. */
  reload: () => void
}

export const StoreContext = createContext<StoreContextValue | null>(null)

export function useStores(): StoreContextValue {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStores must be used inside <StoreProvider>')
  }
  return context
}
