import type { LocalPeekApi } from '../shared/types'

declare global {
  interface Window {
    localpeek: LocalPeekApi
  }
}

export {}
