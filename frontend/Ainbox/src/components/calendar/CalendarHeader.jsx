import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  Search,
  Filter,
  MoreHorizontal,
  Grid3X3,
  Rows3,
  List,
  Clock
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import NotificationBell from '../notifications/NotificationBell'

const viewOptions = [
  { id: 'month', label: 'Month', icon: Grid3X3 },
  { id: 'week', label: 'Week', icon: Rows3 },
  { id: 'day', label: 'Day', icon: List },
  { id: 'agenda', label: 'Agenda', icon: Clock }
]

export default function CalendarHeader({
  currentView,
  currentDate,
  onViewChange,
  onDateChange,
  onEventCreate,
  onSearch
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const handlePrevious = () => {
    const newDate = new Date(currentDate)

    switch (currentView) {
      case 'day':
        newDate.setDate(newDate.getDate() - 1)
        break
      case 'week':
        newDate.setDate(newDate.getDate() - 7)
        break
      case 'month':
        newDate.setMonth(newDate.getMonth() - 1)
        break
      case 'agenda':
        newDate.setDate(newDate.getDate() - 7) // Go back 1 week for agenda
        break
    }

    onDateChange(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(currentDate)

    switch (currentView) {
      case 'day':
        newDate.setDate(newDate.getDate() + 1)
        break
      case 'week':
        newDate.setDate(newDate.getDate() + 7)
        break
      case 'month':
        newDate.setMonth(newDate.getMonth() + 1)
        break
      case 'agenda':
        newDate.setDate(newDate.getDate() + 7) // Go forward 1 week for agenda
        break
    }

    onDateChange(newDate)
  }

  const handleToday = () => {
    onDateChange(new Date())
  }

  const handleSearchChange = (value) => {
    setSearchQuery(value)
    onSearch?.(value)
  }

  const formatHeaderDate = () => {
    const options = {
      year: 'numeric',
      month: 'long'
    }

    switch (currentView) {
      case 'day':
        return currentDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      case 'week':
        const startOfWeek = new Date(currentDate)
        const dayOfWeek = startOfWeek.getDay()
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday)

        const endOfWeek = new Date(startOfWeek)
        endOfWeek.setDate(endOfWeek.getDate() + 6)

        if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
          return `${startOfWeek.getDate()}-${endOfWeek.getDate()} ${startOfWeek.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
        } else {
          return `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        }
      case 'month':
        return currentDate.toLocaleDateString('en-US', options)
      case 'agenda':
        return `Agenda - ${currentDate.toLocaleDateString('en-US', options)}`
      default:
        return currentDate.toLocaleDateString('en-US', options)
    }
  }

  return (
    <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left section - Navigation */}
        <div className="flex items-center gap-4">
          {/* Calendar icon and title */}
          <div className="flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-semibold text-gray-900">Calendar</h1>
          </div>

          {/* Date navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="text-sm"
            >
              Today
            </Button>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevious}
                className="p-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleNext}
                className="p-2"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Current date display */}
            <div className="text-lg font-medium text-gray-900 min-w-0">
              {formatHeaderDate()}
            </div>
          </div>
        </div>

        {/* Center section - Search */}
        <div className="flex-1 max-w-md mx-8">
          {showSearch ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4"
                autoFocus
                onBlur={() => !searchQuery && setShowSearch(false)}
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setShowSearch(true)}
              className="w-full justify-start text-gray-500"
            >
              <Search className="w-4 h-4 mr-2" />
              Search events...
            </Button>
          )}
        </div>

        {/* Right section - Actions and Views */}
        <div className="flex items-center gap-3">
          {/* View selector */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {viewOptions.map((view) => {
              const Icon = view.icon
              const isActive = currentView === view.id

              return (
                <Button
                  key={view.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onViewChange(view.id)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium",
                    isActive
                      ? "bg-white shadow-sm text-gray-900"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  <Icon className="w-3 h-3 mr-1.5" />
                  {view.label}
                </Button>
              )
            })}
          </div>

          {/* Notifications */}
          <NotificationBell />

          {/* Create event button */}
          <Button
            onClick={() => onEventCreate()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Event
          </Button>

          {/* More actions */}
          <Button variant="ghost" size="sm" className="p-2">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}