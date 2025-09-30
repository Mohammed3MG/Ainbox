import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import EmailSidebar from '../components/email/EmailSidebar'
import CalendarHeader from '../components/calendar/CalendarHeader'
import CalendarView from '../components/calendar/CalendarView'
import EventModal from '../components/calendar/EventModal'
import { AccessibilityProvider } from '../components/compose'

function CalendarContent() {
  const { user } = useSession()
  const location = useLocation()

  // Calendar state
  const [currentView, setCurrentView] = useState('month') // month, week, day, agenda
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [eventModalMode, setEventModalMode] = useState('create') // create, edit, view

  // Navigation state for email sidebar
  const [activeFolder] = useState('calendar') // Keep sidebar state but show calendar as active

  // Handle opening event from notification
  useEffect(() => {
    if (location.state?.openEventId) {
      fetchAndOpenEvent(location.state.openEventId);
      // Clear the state to prevent reopening
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Load events based on current date and view
  useEffect(() => {
    loadEvents()
  }, [currentDate, currentView])

  const loadEvents = async () => {
    setLoading(true)
    try {
      // Calculate date range based on current view and date
      const { startDate, endDate } = getDateRange(currentDate, currentView)

      const response = await fetch('/api/calendar/events?' + new URLSearchParams({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        view: currentView
      }), {
        credentials: 'include'
      })

      if (response.ok) {
        const data = await response.json()
        setEvents(data.events || [])
      } else {
        console.error('Failed to load events')
        setEvents([])
      }
    } catch (error) {
      console.error('Error loading events:', error)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  const getDateRange = (date, view) => {
    const start = new Date(date)
    const end = new Date(date)

    switch (view) {
      case 'day':
        start.setHours(0, 0, 0, 0)
        end.setHours(23, 59, 59, 999)
        break
      case 'week':
        // Start of week (Monday)
        const dayOfWeek = start.getDay()
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
        start.setDate(start.getDate() - daysToMonday)
        start.setHours(0, 0, 0, 0)
        // End of week (Sunday)
        end.setDate(start.getDate() + 6)
        end.setHours(23, 59, 59, 999)
        break
      case 'month':
      default:
        // Start of month
        start.setDate(1)
        start.setHours(0, 0, 0, 0)
        // End of month
        end.setMonth(end.getMonth() + 1, 0)
        end.setHours(23, 59, 59, 999)
        break
    }

    return { startDate: start, endDate: end }
  }

  const fetchAndOpenEvent = async (eventId) => {
    try {
      const response = await fetch(`/api/calendar/events/${eventId}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedEvent(data.event);
        setEventModalMode('view');
        setShowEventModal(true);
      } else {
        console.error('Failed to load event');
      }
    } catch (error) {
      console.error('Error loading event:', error);
    }
  }

  const handleViewChange = (view) => {
    setCurrentView(view)
  }

  const handleDateChange = (date) => {
    setCurrentDate(new Date(date))
  }

  const handleEventClick = (event) => {
    setSelectedEvent(event)
    setEventModalMode('view')
    setShowEventModal(true)
  }

  const handleEventCreate = (dateTime = null) => {
    setSelectedEvent(dateTime ? {
      start_time: dateTime,
      end_time: new Date(dateTime.getTime() + 30 * 60000) // 30 minutes default
    } : null)
    setEventModalMode('create')
    setShowEventModal(true)
  }

  const handleEventEdit = (event) => {
    setSelectedEvent(event)
    setEventModalMode('edit')
    setShowEventModal(true)
  }

  const handleEventSave = async (eventData) => {
    try {
      const isEdit = eventModalMode === 'edit' && selectedEvent?.id
      const url = isEdit ? `/api/calendar/events/${selectedEvent.id}` : '/api/calendar/events'
      const method = isEdit ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(eventData)
      })

      if (response.ok) {
        const savedEvent = await response.json()

        if (isEdit) {
          setEvents(prev => prev.map(e => e.id === savedEvent.event.id ? savedEvent.event : e))
        } else {
          setEvents(prev => [...prev, savedEvent.event])
        }

        setShowEventModal(false)
        setSelectedEvent(null)
      } else {
        const error = await response.json()
        throw new Error(error.message || 'Failed to save event')
      }
    } catch (error) {
      console.error('Error saving event:', error)
      alert('Failed to save event: ' + error.message)
    }
  }

  const handleEventDelete = async (eventId) => {
    if (!confirm('Are you sure you want to delete this event?')) return

    try {
      const response = await fetch(`/api/calendar/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (response.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId))
        setShowEventModal(false)
        setSelectedEvent(null)
      } else {
        throw new Error('Failed to delete event')
      }
    } catch (error) {
      console.error('Error deleting event:', error)
      alert('Failed to delete event: ' + error.message)
    }
  }

  const handleCloseModal = () => {
    setShowEventModal(false)
    setSelectedEvent(null)
  }

  // Dummy handler for sidebar - we're not changing folders in calendar view
  const handleFolderChange = () => {
    // This could navigate back to email or handle calendar-specific navigation
    console.log('Folder change requested from calendar')
  }

  const handleCompose = () => {
    // This could open compose modal or navigate
    console.log('Compose requested from calendar')
  }

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col">
      {/* Header */}
      <CalendarHeader
        currentView={currentView}
        currentDate={currentDate}
        onViewChange={handleViewChange}
        onDateChange={handleDateChange}
        onEventCreate={handleEventCreate}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Modified to show calendar as active */}
        <EmailSidebar
          activeFolder="calendar"
          onFolderChange={handleFolderChange}
          onCompose={handleCompose}
          inboxUnread={0}
          spamUnread={0}
        />

        {/* Calendar content area */}
        <CalendarView
          view={currentView}
          currentDate={currentDate}
          events={events}
          loading={loading}
          onEventClick={handleEventClick}
          onEventCreate={handleEventCreate}
          onDateChange={handleDateChange}
        />
      </div>

      {/* Event Modal */}
      {showEventModal && (
        <EventModal
          mode={eventModalMode}
          event={selectedEvent}
          onSave={handleEventSave}
          onEdit={handleEventEdit}
          onDelete={handleEventDelete}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}

export default function Calendar() {
  return (
    <AccessibilityProvider>
      <CalendarContent />
    </AccessibilityProvider>
  )
}