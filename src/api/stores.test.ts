import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockSingle = vi.fn()
const mockOrder = vi.fn()
const mockFrom = vi.fn()
const mockGetUser = vi.fn()

vi.mock('../api/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

describe('createStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    })
  })

  it('inserts without requesting a representation (no .select() on insert)', async () => {
    // The insert should NOT chain .select() or .single()
    mockInsert.mockResolvedValue({ data: null, error: null })
    mockOrder.mockResolvedValue({
      data: [{ id: 'store-456', name: 'Test Store', owner_id: 'user-123' }],
      error: null,
    })

    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: () => ({ order: mockOrder }),
    })

    const { createStore } = await import('./stores')
    const result = await createStore('Test Store')

    // Verify insert was called without .select() chained
    expect(mockInsert).toHaveBeenCalledWith({ owner_id: 'user-123', name: 'Test Store' })
    expect(mockSingle).not.toHaveBeenCalled()

    // Verify the store was fetched in a separate request
    expect(mockOrder).toHaveBeenCalled()
    expect(result.id).toBe('store-456')
  })

  it('throws if the created store cannot be found after insert', async () => {
    mockInsert.mockResolvedValue({ data: null, error: null })
    mockOrder.mockResolvedValue({ data: [], error: null })

    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: () => ({ order: mockOrder }),
    })

    const { createStore } = await import('./stores')

    await expect(createStore('Missing Store')).rejects.toThrow(/qayta o‘qib bo‘lmadi/)
  })

  it('throws if no session exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const { createStore } = await import('./stores')

    await expect(createStore('Test')).rejects.toThrow(/Sessiya topilmadi/)
  })
})
