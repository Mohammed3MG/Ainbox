import { useMemo } from 'react'
import { cn } from '../../../lib/utils'
import { Badge } from '../../ui/badge'

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function MonthView({
  currentDate,
  events,
  onEventClick,
  onDateClick,
  onTimeSlotClick
}) {
  // Helper function to check if a date is today
  const isToday = (date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    // First day of the month
    const firstDay = new Date(year, month, 1)
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0)

    // Get day of week for first day (0 = Sunday, 1 = Monday, etc.)
    // Convert to Monday = 0, Sunday = 6
    const firstDayOfWeek = (firstDay.getDay() + 6) % 7

    // Start from Monday of the first week
    const startDate = new Date(firstDay)
    startDate.setDate(firstDay.getDate() - firstDayOfWeek)

    // Generate 6 weeks (42 days) to cover all possible month layouts
    const days = []
    for (let i = 0; i < 42; i++) {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + i)

      // Check if this date has events
      const dayEvents = events.filter(event => {
        const eventDate = new Date(event.start_time)
        return (
          eventDate.getDate() === date.getDate() &&
          eventDate.getMonth() === date.getMonth() &&
          eventDate.getFullYear() === date.getFullYear()
        )
      })

      days.push({
        date: date,
        isCurrentMonth: date.getMonth() === month,
        isToday: isToday(date),
        events: dayEvents
      })
    }

    return days
  }, [currentDate, events])

  const handleDayClick = (day) => {
    // Set time to 9 AM for new events
    const eventTime = new Date(day.date)
    eventTime.setHours(9, 0, 0, 0)
    onTimeSlotClick(eventTime)
  }

  const handleEventClick = (event, e) => {
    e.stopPropagation()
    onEventClick(event, e)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with days of week */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="px-3 py-3 text-sm font-medium text-gray-500 text-center border-r border-gray-200 last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className={cn(
              "border-r border-b border-gray-200 last:border-r-0 p-2 cursor-pointer hover:bg-gray-50 transition-colors min-h-[120px]",
              !day.isCurrentMonth && "bg-gray-50 text-gray-400",
              day.isToday && "bg-blue-50"
            )}
            onClick={() => handleDayClick(day)}
          >
            {/* Date number */}
            <div className="flex justify-between items-start mb-1">
              <span
                className={cn(
                  "text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full",
                  day.isToday && "bg-blue-600 text-white",
                  !day.isCurrentMonth && "text-gray-400"
                )}
              >
                {day.date.getDate()}
              </span>

              {/* Event count indicator */}
              {day.events.length > 3 && (
                <span className="text-xs text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                  +{day.events.length - 3}
                </span>
              )}
            </div>

            {/* Events */}
            <div className="space-y-1">
              {day.events.slice(0, 3).map((event, eventIndex) => (
                <div
                  key={event.id || eventIndex}
                  onClick={(e) => handleEventClick(event, e)}
                  className={cn(
                    "text-xs p-1 rounded cursor-pointer hover:opacity-80 transition-opacity truncate",
                    "text-white"
                  )}
                  style={{ backgroundColor: event.color }}
                  title={`${event.title} - ${new Date(event.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}`}
                >
                  <div className="font-medium truncate">{event.title}</div>
                  {!event.isAllDay && (
                    <div className="opacity-75">
                      {new Date(event.start_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}