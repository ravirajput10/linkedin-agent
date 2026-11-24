import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from '@/App'
import { AuthProvider } from '@/auth/AuthContext'
import { ApiRequestError } from '@/services/client'

import '@/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // A 4xx is a client mistake; retrying will not fix it.
        if (error instanceof ApiRequestError && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('Root element is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* Inside the router: the guards navigate, and inside the query client:
            signing in and out clears the cache so one account never reads
            another's pages. */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
