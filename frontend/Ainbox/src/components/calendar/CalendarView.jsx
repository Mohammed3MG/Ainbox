import { useState, useMemo } from 'react'
import { cn } from '../../lib/utils'
import MonthView from './views/MonthView'
import WeekView from './views/WeekView'
import DayView from './views/DayView'
import AgendaView from './views/AgendaView'

export default function CalendarView({
  view,
  currentDate,
  events,
  loading,
  onEventClick,
  onEventCreate,
  onDateChange
}) {
  // Process events to add computed properties
  const processedEvents = useMemo(() => {
    return events.map(event => ({
      ...event,
      startDate: new Date(event.start_time),
      endDate: new Date(event.end_time),
      isAllDay: event.is_all_day || false,
      color: event.color || '#3B82F6'
    }))
  }, [events])

  const handleTimeSlotClick = (dateTime) => {
    onEventCreate(dateTime)
  }

  const handleDateClick = (date) => {
    if (view === 'month') {
      // If clicking a date in month view, switch to day view for that date
      onDateChange(date)
    } else {
      // For other views, create event at clicked date
      onEventCreate(date)
    }
  }

  const handleEventClick = (event, e) => {
    e.stopPropagation()
    onEventClick(event)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading calendar...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-gray-50 overflow-hidden">
      {view === 'month' && (
        <MonthView
          currentDate={currentDate}
          events={processedEvents}
          onEventClick={handleEventClick}
          onDateClick={handleDateClick}
          onTimeSlotClick={handleTimeSlotClick}
        />
      )}

      {view === 'week' && (
        <WeekView
          currentDate={currentDate}
          events={processedEvents}
          onEventClick={handleEventClick}
          onTimeSlotClick={handleTimeSlotClick}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          events={processedEvents}
          onEventClick={handleEventClick}
          onTimeSlotClick={handleTimeSlotClick}
        />
      )}

      {view === 'agenda' && (
        <AgendaView
          currentDate={currentDate}
          events={processedEvents}
          onEventClick={handleEventClick}
          onDateChange={onDateChange}
        />
      )}
    </div>
  )
}