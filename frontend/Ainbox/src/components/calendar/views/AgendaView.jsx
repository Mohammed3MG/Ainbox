import { useMemo } from 'react'
import { cn } from '../../../lib/utils'
import { Calendar, Clock, MapPin, Users } from 'lucide-react'

export default function AgendaView({
  currentDate,
  events,
  onEventClick,
  onDateChange
}) {
  // Group events by date for the next 30 days
  const groupedEvents = useMemo(() => {
    const startDate = new Date(currentDate)
    startDate.setHours(0, 0, 0, 0)

    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 30)

    // Filter events in the next 30 days
    const upcomingEvents = events.filter(event => {
      const eventDate = new Date(event.start_time)
      return eventDate >= startDate && eventDate < endDate
    })

    // Group by date
    const grouped = {}
    upcomingEvents.forEach(event => {
      const eventDate = new Date(event.start_time)
      const dateKey = eventDate.toDateString()

      if (!grouped[dateKey]) {
        grouped[dateKey] = {
          date: eventDate,
          events: []
        }
      }
      grouped[dateKey].events.push(event)
    })

    // Sort dates and events
    return Object.values(grouped)
      .sort((a, b) => a.date - b.date)
      .map(day => ({
        ...day,
        events: day.events.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      }))
  }, [currentDate, events])

  const isToday = (date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  const isTomorrow = (date) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return (
      date.getDate() === tomorrow.getDate() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getFullYear() === tomorrow.getFullYear()
    )
  }

  const formatDate = (date) => {
    if (isToday(date)) return 'Today'
    if (isTomorrow(date)) return 'Tomorrow'

    const today = new Date()
    const diffTime = date - today
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' })
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatTime = (start_time, end_time) => {
    const start = new Date(start_time)
    const end = new Date(end_time)

    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    return `${startTime} - ${endTime}`
  }

  const getDuration = (start_time, end_time) => {
    const duration = (new Date(end_time) - new Date(start_time)) / (1000 * 60) // minutes

    if (duration < 60) {
      return `${duration}m`
    } else {
      const hours = Math.floor(duration / 60)
      const minutes = duration % 60
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }
  }

  if (groupedEvents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No upcoming events</h3>
          <p className="text-gray-500">Your calendar is clear for the next 30 days.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-gray-50 overflow-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="space-y-6">
          {groupedEvents.map((day) => (
            <div key={day.date.toISOString()} className="bg-white rounded-lg shadow-sm border border-gray-200">
              {/* Date header */}
              <div className={cn(
                "px-6 py-4 border-b border-gray-200",
                isToday(day.date) && "bg-blue-50"
              )}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className={cn(
                      "text-lg font-semibold",
                      isToday(day.date) ? "text-blue-900" : "text-gray-900"
                    )}>
                      {formatDate(day.date)}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {day.date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    {day.events.length} {day.events.length === 1 ? 'event' : 'events'}
                  </div>
                </div>
              </div>

              {/* Events list */}
              <div className="divide-y divide-gray-100">
                {day.events.map((event, eventIndex) => (
                  <div
                    key={event.id || eventIndex}
                    onClick={() => onEventClick(event)}
                    className="p-6 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Event color indicator */}
                      <div
                        className="w-1 h-16 rounded-full flex-shrink-0 mt-1"
                        style={{ backgroundColor: event.color }}
                      />

                      {/* Event details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-medium text-gray-900 truncate">
                              {event.title}
                            </h3>

                            {event.description && (
                              <p className="text-gray-600 mt-1 line-clamp-2">
                                {event.description}
                              </p>
                            )}
                          </div>

                          {/* Meeting type badge */}
                          {event.meeting_type && (
                            <span className="ml-4 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 capitalize">
                              {event.meeting_type.replace('-', ' ')}
                            </span>
                          )}
                        </div>

                        {/* Event metadata */}
                        <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>{formatTime(event.start_time, event.end_time)}</span>
                            <span className="text-gray-400">({getDuration(event.start_time, event.end_time)})</span>
                          </div>

                          {event.location && (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              <span className="truncate">{event.location}</span>
                            </div>
                          )}

                          {event.attendees && event.attendees.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              <span>{event.attendees.length} attendees</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}