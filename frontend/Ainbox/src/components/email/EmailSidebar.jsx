import { useState } from 'react'
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Trash2,
  ShieldAlert,
  Plus,
  Circle
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'

const sidebarItems = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, count: 2, active: true },
  { id: 'starred', label: 'Starred', icon: Star, count: 0 },
  { id: 'sent', label: 'Sent', icon: Send, count: 0 },
  { id: 'drafts', label: 'Drafts', icon: FileText, count: 0 },
  { id: 'archive', label: 'Archive', icon: Archive, count: 0 },
  { id: 'trash', label: 'Trash', icon: Trash2, count: 0 },
  { id: 'spam', label: 'Spam', icon: ShieldAlert, count: 0 },
]

const labels = [
  { id: 'work', label: 'Work', color: 'bg-blue-500' },
  { id: 'personal', label: 'Personal', color: 'bg-green-500' },
  { id: 'finance', label: 'Finance', color: 'bg-purple-500' },
  { id: 'marketing', label: 'Marketing', color: 'bg-pink-500' },
]

export default function EmailSidebar({ activeFolder, onFolderChange, onCompose, inboxUnread = 0 }) {
  const [storageUsed] = useState(33)

  // Debug log for unread count
  console.log('EmailSidebar: inboxUnread =', inboxUnread)

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen overflow-hidden">
      {/* Logo */}
      <div className="flex-shrink-0 p-6 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <Star className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Ainbox</h1>
            <p className="text-sm text-gray-500">AI-Powered Email</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-shrink-0 p-4 space-y-1">
        {sidebarItems.map((item) => {
          const Icon = item.icon
          const isActive = activeFolder === item.id
          const dynamicCount = item.id === 'inbox' ? inboxUnread : item.count

          // Debug log for each item
          if (item.id === 'inbox') {
            console.log('Inbox item - inboxUnread:', inboxUnread, 'dynamicCount:', dynamicCount)
          }

          return (
            <button
              key={item.id}
              onClick={() => onFolderChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {dynamicCount > 0 && (
                <Badge
                  variant={isActive ? "secondary" : "default"}
                  className={cn(
                    "text-xs font-semibold min-w-[20px] h-5 flex items-center justify-center",
                    item.id === 'inbox'
                      ? isActive
                        ? "bg-red-500 text-white"
                        : "bg-red-500 text-white"
                      : isActive
                        ? "bg-blue-500 text-white"
                        : "bg-blue-100 text-blue-600"
                  )}
                >
                  {dynamicCount}
                </Badge>
              )}
            </button>
          )
        })}
      </div>

      {/* Labels */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Labels</h3>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="space-y-1">
          {labels.map((label) => (
            <button
              key={label.id}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <Circle className={cn("w-3 h-3", label.color)} />
              <span className="flex-1 text-left">{label.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Storage - Fixed at bottom */}
      <div className="flex-shrink-0 mt-auto p-4 border-t border-gray-200">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Storage</span>
            <span className="text-sm text-gray-500">{storageUsed}%</span>
          </div>
          <Progress value={storageUsed} className="h-2" />
          <p className="text-xs text-gray-500">
            {storageUsed}% of 15 GB used
          </p>
        </div>
      </div>
    </div>
  )
}
