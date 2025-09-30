import { useMemo } from 'react'
import { cn } from '../../../lib/utils'

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function WeekView({
  currentDate,
  events,
  onEventClick,
  onTimeSlotClick
}) {
  // Get week dates
  const weekDates = useMemo(() => {
    const startOfWeek = new Date(currentDate)
    const dayOfWeek = startOfWeek.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    startOfWeek.setDate(startOfWeek.getDate() - daysToMonday)

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startOfWeek)
      date.setDate(startOfWeek.getDate() + i)
      return date
    })
  }, [currentDate])

  const isToday = (date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  const handleTimeSlotClick = (date, hour) => {
    const eventTime = new Date(date)
    eventTime.setHours(hour, 0, 0, 0)
    onTimeSlotClick(eventTime)
  }

  const getEventsForDateAndHour = (date, hour) => {
    return events.filter(event => {
      const eventStart = new Date(event.start_time)
      const eventEnd = new Date(event.end_time)
      const slotStart = new Date(date)
      slotStart.setHours(hour, 0, 0, 0)
      const slotEnd = new Date(date)
      slotEnd.setHours(hour + 1, 0, 0, 0)

      // Check if event overlaps with this hour slot
      return eventStart < slotEnd && eventEnd > slotStart &&
             eventStart.getDate() === date.getDate() &&
             eventStart.getMonth() === date.getMonth() &&
             eventStart.getFullYear() === date.getFullYear()
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
      {/* Header with dates */}
      <div className="flex border-b border-gray-200">
        {/* Time column header */}
        <div className="w-16 border-r border-gray-200 p-3">
          <div className="text-sm font-medium text-gray-500">Time</div>
        </div>

        {/* Day headers */}
        {weekDates.map((date, index) => (
          <div
            key={index}
            className={cn(
              "flex-1 p-3 text-center border-r border-gray-200 last:border-r-0",
              isToday(date) && "bg-blue-50"
            )}
          >
            <div className="text-sm font-medium text-gray-900">
              {DAYS_OF_WEEK[index]}
            </div>
            <div
              className={cn(
                "text-lg font-semibold mt-1 w-8 h-8 flex items-center justify-center rounded-full mx-auto",
                isToday(date) && "bg-blue-600 text-white"
              )}
            >
              {date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-h-full">
          {HOURS.map((hour) => (
            <div key={hour} className="flex border-b border-gray-100 min-h-[60px]">
              {/* Time label */}
              <div className="w-16 border-r border-gray-200 p-2 text-right">
                <span className="text-xs text-gray-500">{formatHour(hour)}</span>
              </div>

              {/* Day columns */}
              {weekDates.map((date, dayIndex) => {
                const dayEvents = getEventsForDateAndHour(date, hour)

                return (
                  <div
                    key={dayIndex}
                    className={cn(
                      "flex-1 border-r border-gray-200 last:border-r-0 p-1 cursor-pointer hover:bg-gray-50 transition-colors relative",
                      isToday(date) && "bg-blue-50 hover:bg-blue-100"
                    )}
                    onClick={() => handleTimeSlotClick(date, hour)}
                  >
                    {/* Events for this time slot */}
                    {dayEvents.map((event, eventIndex) => {
                      const eventStart = new Date(event.start_time)
                      const eventEnd = new Date(event.end_time)
                      const duration = (eventEnd - eventStart) / (1000 * 60) // minutes
                      const height = Math.max(20, (duration / 60) * 60) // 60px per hour, minimum 20px

                      return (
                        <div
                          key={event.id || eventIndex}
                          onClick={(e) => {
                            e.stopPropagation()
                            onEventClick(event, e)
                          }}
                          className="absolute left-1 right-1 rounded text-xs p-1 cursor-pointer hover:opacity-80 transition-opacity text-white"
                          style={{
                            backgroundColor: event.color,
                            height: `${height}px`,
                            top: `${(eventStart.getMinutes() / 60) * 60}px`,
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
                          <div className="font-medium truncate">{event.title}</div>
                          <div className="opacity-75 truncate">
                            {eventStart.toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}