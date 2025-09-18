import { useState } from 'react'
import {
  Search,
  RotateCcw,
  Zap,
  MoreHorizontal,
  ChevronLeft,
  Settings
} from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { useSession } from '../../hooks/useSession'

export default function EmailHeader({
  currentFolder,
  onBack,
  showBackButton = false,
  onCompose,
  searchQuery,
  onSearchChange
}) {
  const { user } = useSession()

  const getFolderTitle = (folder) => {
    const titles = {
      inbox: 'Inbox',
      starred: 'Starred',
      sent: 'Sent',
      drafts: 'Drafts',
      archive: 'Archive',
      trash: 'Trash',
      spam: 'Spam'
    }
    return titles[folder] || 'Inbox'
  }

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left side - Back button and title */}
        <div className="flex items-center gap-4">
          {showBackButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="p-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          <h1 className="text-xl font-semibold text-gray-900">
            {getFolderTitle(currentFolder)}
          </h1>
        </div>

        {/* Center - Search */}
        <div className="flex-1 max-w-md mx-8">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search mail (press /)"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-gray-50 border-gray-200 focus:bg-white"
            />
          </div>
        </div>

        {/* Right side - Actions and user menu */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="p-2">
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="p-2">
            <Zap className="w-4 h-4" />
          </Button>

          <Button
            onClick={onCompose}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2"
          >
            Compose
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 p-2">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="bg-purple-500 text-white text-sm">
                    {user?.name?.charAt(0)?.toUpperCase() || 'M'}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-gray-700 hidden sm:block">
                  {user?.name || 'Mohammed'}
                </span>
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
