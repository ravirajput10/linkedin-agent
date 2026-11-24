import { NavLink } from "react-router-dom"
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChevronsUpDownIcon, UserIcon, LogOutIcon } from "lucide-react"
import { Badge } from "@/components/ui"
import type { UserProfile } from "@/types/api"

export function NavUser({
  user,
  onSignOut,
}: {
  user: UserProfile
  onSignOut: () => void | Promise<void>
}) {
  const { isMobile, setOpenMobile } = useSidebar()

  const displayName = user.full_name || user.email
  const initials = (user.full_name || user.email)
    .slice(0, 2)
    .toUpperCase()

  const profileUrl = user.role === 'ADMIN' ? '/admin/profile' : '/profile'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="text-gray-300 hover:bg-gray-800 hover:text-white data-open:bg-gray-800 data-open:text-white"
              />
            }
          >
            <Avatar className="size-8 rounded-lg bg-gray-800 text-white border border-gray-700">
              <AvatarFallback className="rounded-lg bg-gray-800 text-xs font-semibold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium text-white">{displayName}</span>
              <span className="truncate text-xs text-gray-400">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4 text-gray-400 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 rounded-lg border border-gray-800 bg-[#111827] text-white shadow-xl p-1"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2.5 px-2 py-2 text-left text-sm">
                  <Avatar className="size-8 rounded-lg bg-gray-800 text-white border border-gray-700 shrink-0">
                    <AvatarFallback className="rounded-lg bg-gray-800 text-xs font-semibold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate font-medium text-white text-sm" title={displayName}>
                        {displayName}
                      </span>
                      {user.role === 'ADMIN' && (
                        <Badge tone="accent" className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5">
                          ADMIN
                        </Badge>
                      )}
                    </div>
                    <span className="truncate text-xs text-gray-400 mt-0.5" title={user.email}>
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-gray-800" />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-gray-200 hover:bg-gray-800 hover:text-white focus:bg-gray-800 focus:text-white"
                render={<NavLink to={profileUrl} onClick={() => setOpenMobile(false)} />}
              >
                <UserIcon className="size-4" />
                Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-gray-800" />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-red-400 hover:bg-red-950/40 hover:text-red-300 focus:bg-red-950/40 focus:text-red-300"
              onSelect={() => {
                setOpenMobile(false)
                onSignOut()
              }}
              onClick={() => {
                setOpenMobile(false)
                onSignOut()
              }}
            >
              <LogOutIcon className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
