import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { AppSidebar } from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { approvalsApi, settingsApi } from '@/services/api'

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Administration',
  dashboard: 'Dashboard',
  audiences: 'Audiences',
  campaigns: 'Campaigns',
  new: 'New Campaign',
  'content-studio': 'Content Studio',
  candidates: 'Candidates',
  posts: 'Posts',
  approvals: 'Approvals',
  'scheduled-actions': 'Scheduled Actions',
  activity: 'Agent Activity',
  analytics: 'Analytics',
  settings: 'Settings',
  profile: 'Profile',
  users: 'Users',
  plans: 'Plans',
}

function getBreadcrumbs(pathname: string): { label: string; to?: string }[] {
  if (pathname === '/' || pathname === '') {
    return [{ label: 'Dashboard', to: '/' }]
  }

  const segments = pathname.split('/').filter(Boolean)
  const crumbs: { label: string; to?: string }[] = []

  if (segments[0] === 'admin') {
    crumbs.push({ label: 'Administration', to: '/admin/dashboard' })

    if (segments.length === 1) {
      return [{ label: 'Administration', to: '/admin/dashboard' }, { label: 'Dashboard' }]
    }

    const sub = segments[1]
    const subLabel = SEGMENT_LABELS[sub] || (sub.length > 15 ? 'Details' : sub)

    if (segments.length === 2) {
      crumbs.push({ label: subLabel })
    } else if (segments.length >= 3) {
      crumbs.push({ label: subLabel, to: `/admin/${sub}` })
      const detailSegment = segments[2]
      if (detailSegment === 'new') {
        crumbs.push({ label: 'New Campaign' })
      } else {
        const detailLabel =
          sub === 'campaigns'
            ? 'Campaign Details'
            : sub === 'candidates'
              ? 'Candidate Details'
              : sub === 'users'
                ? 'User Details'
                : 'Details'
        crumbs.push({ label: detailLabel })
      }
    }

    return crumbs
  }

  // Non-admin (User) routes
  let acc = ''
  segments.forEach((seg, i) => {
    acc += `/${seg}`
    const isLast = i === segments.length - 1

    let label = SEGMENT_LABELS[seg]
    if (!label) {
      if (i > 0 && segments[i - 1] === 'campaigns') label = 'Campaign Details'
      else if (i > 0 && segments[i - 1] === 'candidates') label = 'Candidate Details'
      else label = seg.length > 15 ? 'Details' : seg
    }

    crumbs.push({
      label,
      to: isLast ? undefined : acc,
    })
  })

  return crumbs
}

export function AppLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const { data: counts } = useQuery({
    queryKey: ['approvals', 'counts'],
    queryFn: approvalsApi.counts,
    refetchInterval: 15_000,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const pendingApprovals = counts
    ? Object.values(counts).reduce((total, value) => total + value, 0)
    : 0

  async function handleSignOut() {
    navigate('/', { replace: true })
    await logout()
  }

  const breadcrumbs = getBreadcrumbs(location.pathname)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          pendingApprovals={pendingApprovals}
          settings={settings}
          onSignOut={handleSignOut}
        />
        <SidebarInset className="min-w-0 bg-surface-muted">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface/95 px-4 backdrop-blur supports-backdrop-filter:bg-surface/80 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <SidebarTrigger className="-ml-1 text-ink hover:bg-surface-sunken" />
            <Separator orientation="vertical" className="h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1
                  return (
                    <React.Fragment key={`${crumb.label}-${index}`}>
                      <BreadcrumbItem>
                        {isLast || !crumb.to ? (
                          <BreadcrumbPage className="font-medium text-ink">
                            {crumb.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            render={<NavLink to={crumb.to} />}
                            className="text-ink-muted hover:text-ink"
                          >
                            {crumb.label}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </React.Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </header>

          <main className="min-w-0 flex-1 px-4 pt-3 pb-6 sm:px-5 sm:pt-4 sm:pb-8">
            <div className="w-full space-y-5">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
