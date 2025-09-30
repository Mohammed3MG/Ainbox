import { useMemo } from 'react'
import { cn } from '../../../lib/utils'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function DayView({
  currentDate,
  events,
  onEventClick,
  onTimeSlotClick
}) {
  const dayEvents = useMemo(() => {
    return events.filter(event => {
      const eventDate = new Date(event.start_time)
      return (
        eventDate.getDate() === currentDate.getDate() &&
        eventDate.getMonth() === currentDate.getMonth() &&
        eventDate.getFullYear() === currentDate.getFullYear()
      )
    })
  }, [currentDate, events])

  const isToday = () => {
    const today = new Date()
    return (
      currentDate.getDate() === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    )
  }

  const handleTimeSlotClick = (hour) => {
    const eventTime = new Date(currentDate)
    eventTime.setHours(hour, 0, 0, 0)
    onTimeSlotClick(eventTime)
  }

  const getEventsForHour = (hour) => {
    return dayEvents.filter(event => {
      const eventStart = new Date(event.start_time)
      const eventEnd = new Date(event.end_time)
      const slotStart = new Date(currentDate)
      slotStart.setHours(hour, 0, 0, 0)
      const slotEnd = new Date(currentDate)
      slotEnd.setHours(hour + 1, 0, 0, 0)

      return eventStart < slotEnd && eventEnd > slotStart
    })
  }

  const formatHour = (hour) => {
    if (hour === 0) return '12 AM'
    if (hour === 12) return '12 PM'
    if (hour < 12) return `${hour} AM`
    return `${hour - 12} PM`
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Day header */}
      <div className={cn(
        "p-4 border-b border-gray-200 text-center",
        isToday() && "bg-blue-50"
      )}>
        <div className="text-sm font-medium text-gray-500">
          {currentDate.toLocaleDateString('en-US', { weekday: 'long' })}
        </div>
        <div className={cn(
          "text-2xl font-bold mt-1 w-12 h-12 flex items-center justify-center rounded-full mx-auto",
          isToday() && "bg-blue-600 text-white"
        )}>
          {currentDate.getDate()}
        </div>
        <div className="text-sm text-gray-500 mt-1">
          {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-h-full">
          {HOURS.map((hour) => {
            const hourEvents = getEventsForHour(hour)

            return (
              <div key={hour} className="flex border-b border-gray-100 min-h-[80px]">
                {/* Time label */}
                <div className="w-20 border-r border-gray-200 p-3 text-right">
                  <span className="text-sm text-gray-500">{formatHour(hour)}</span>
                </div>

                {/* Event area */}
                <div
                  className={cn(
                    "flex-1 p-2 cursor-pointer hover:bg-gray-50 transition-colors relative",
                    isToday() && "bg-blue-50 hover:bg-blue-100"
                  )}
                  onClick={() => handleTimeSlotClick(hour)}
                >
                  {/* Events for this hour */}
                  {hourEvents.map((event, eventIndex) => {
                    const eventStart = new Date(event.start_time)
                    const eventEnd = new Date(event.end_time)
                    const duration = (eventEnd - eventStart) / (1000 * 60) // minutes
                    const height = Math.max(24, (duration / 60) * 80) // 80px per hour, minimum 24px

                    return (
                      <div
                        key={event.id || eventIndex}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick(event, e)
                        }}
                        className="absolute left-2 right-2 rounded p-2 cursor-pointer hover:opacity-80 transition-opacity text-white shadow-sm"
                        style={{
                          backgroundColor: event.color,
                          height: `${height}px`,
                          top: `${8 + (eventStart.getMinutes() / 60) * 80}px`,
                          zIndex: 10
                        }}
                        title={`${event.title} - ${eventStart.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })} to ${eventEnd.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}`}
                      >
                        <div className="font-medium text-sm">{event.title}</div>
                        <div className="opacity-90 text-xs mt-1">
                          {eventStart.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })} - {eventEnd.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </div>
                        {event.location && (
                          <div className="opacity-75 text-xs truncate">
                            📍 {event.location}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}