import * as React from "react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  Megaphone,
  Users,
  FileText,
  CheckSquare,
  Clock,
  Activity,
  BarChart3,
  Settings,
  ShieldCheck,
  CreditCard,
  Sparkles,
  PenLine,
} from "lucide-react"
import clsx from "clsx"

import { useAuth } from "@/auth/AuthContext"
import { Badge } from "@/components/ui"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import type { AppSettings } from "@/types/api"

interface NavItem {
  url: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  badge?: 'approvals'
}

const USER_NAV_ITEMS: NavItem[] = [
  { url: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { url: '/audiences', label: 'Audiences', icon: Users },
  { url: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { url: '/content-studio', label: 'Content Studio', icon: PenLine },
  { url: '/candidates', label: 'Candidates', icon: Users },
  { url: '/posts', label: 'Posts', icon: FileText },
  { url: '/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals' as const },
  { url: '/scheduled-actions', label: 'Scheduled Actions', icon: Clock },
  { url: '/activity', label: 'Agent Activity', icon: Activity },
  { url: '/analytics', label: 'Analytics', icon: BarChart3 },
  { url: '/settings', label: 'Settings', icon: Settings },
]

const ADMIN_PLATFORM_ITEMS: NavItem[] = [
  { url: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { url: '/admin/audiences', label: 'Audiences', icon: Users },
  { url: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
  { url: '/admin/content-studio', label: 'Content Studio', icon: PenLine },
  { url: '/admin/candidates', label: 'Candidates', icon: Users },
  { url: '/admin/posts', label: 'Posts', icon: FileText },
  { url: '/admin/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals' as const },
  { url: '/admin/scheduled-actions', label: 'Scheduled Actions', icon: Clock },
  { url: '/admin/activity', label: 'Agent Activity', icon: Activity },
  { url: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { url: '/admin/settings', label: 'Settings', icon: Settings },
]

const ADMIN_MANAGEMENT_ITEMS: NavItem[] = [
  { url: '/admin/users', label: 'Users', icon: ShieldCheck },
  { url: '/admin/plans', label: 'Plans', icon: CreditCard },
]

function isRouteActive(url: string, end?: boolean, pathname = '') {
  if (end || url === '/' || url === '/dashboard' || url === '/admin/dashboard') {
    return pathname === url || (url === '/dashboard' && pathname === '/')
  }
  return pathname === url || pathname.startsWith(`${url}/`)
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  pendingApprovals?: number
  settings?: AppSettings
  onSignOut?: () => void | Promise<void>
}

export function AppSidebar({
  pendingApprovals = 0,
  settings,
  onSignOut,
  ...props
}: AppSidebarProps) {
  const { user, isAdmin, logout } = useAuth()
  const { setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const handleSignOut =
    onSignOut ||
    (async () => {
      navigate('/', { replace: true })
      await logout()
    })

  const navItems = isAdmin ? ADMIN_PLATFORM_ITEMS : USER_NAV_ITEMS

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-gray-800 bg-[#111827] text-white"
      {...props}
    >
      <SidebarHeader className="border-b border-gray-800 bg-[#111827]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="hover:bg-gray-800/70 active:bg-gray-800 transition-colors cursor-pointer group"
              tooltip="Go to Landing Page"
              render={
                <Link
                  to="/"
                  title="Go to Landing Page"
                  onClick={() => setOpenMobile(false)}
                />
              }
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-[#2445C8] text-white shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                <Sparkles className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-semibold text-white group-hover:text-blue-300 transition-colors">AI Engagement Agent</span>
                <span className="truncate text-xs text-gray-400">Campaign &amp; workflow</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="bg-[#111827] text-white">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-gray-400 group-data-[collapsible=icon]:hidden">
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {navItems.map((item) => {
                const isActive = isRouteActive(item.url, item.end, location.pathname)
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.label}
                      className={clsx(
                        isActive
                          ? "bg-[#2445C8] font-medium text-white shadow-sm hover:bg-[#2445C8] hover:text-white"
                          : "text-gray-300 hover:bg-gray-800 hover:text-white"
                      )}
                      render={
                        <NavLink
                          to={item.url}
                          end={item.end}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <item.icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.badge === 'approvals' && pendingApprovals > 0 && (
                      <SidebarMenuBadge className="border border-amber-500/30 bg-amber-500/20 text-xs font-semibold text-amber-300">
                        {pendingApprovals}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-gray-400 group-data-[collapsible=icon]:hidden">
              Administration
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {ADMIN_MANAGEMENT_ITEMS.map((item) => {
                  const isActive = isRouteActive(item.url, false, location.pathname)
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        className={clsx(
                          isActive
                            ? "bg-[#2445C8] font-medium text-white shadow-sm hover:bg-[#2445C8] hover:text-white"
                            : "text-gray-300 hover:bg-gray-800 hover:text-white"
                        )}
                        render={
                          <NavLink
                            to={item.url}
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {settings && (
          <div className="mx-2 mt-auto mb-2 rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs text-gray-300 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Mode</span>
              {settings.dry_run ? (
                <Badge tone="caution">DRY RUN</Badge>
              ) : (
                <Badge tone="positive">LIVE</Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-gray-400">Model</span>
              <span className="truncate font-medium text-white" title={settings.llm.model}>
                {settings.llm.provider}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-gray-400">Platform</span>
              <span className="font-medium text-white">{settings.platform}</span>
            </div>
          </div>
        )}
      </SidebarContent>

      {user && (
        <SidebarFooter className="border-t border-gray-800 px-3 py-2 bg-[#111827]">
          <NavUser user={user} onSignOut={handleSignOut} />
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  )
}
