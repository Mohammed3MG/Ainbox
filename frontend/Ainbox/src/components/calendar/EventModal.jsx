import { useState, useEffect } from 'react'
import { X, Calendar, Clock, MapPin, Users, Type, Palette, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
import { useSession } from '../../hooks/useSession'
import { useToast } from '../ui/toast'
import AttendeeManagement from './AttendeeManagement'
import AttendeeList from './AttendeeList'

const MEETING_TYPES = [
  { value: 'one-on-one', label: 'One-on-one', color: '#3B82F6' },
  { value: 'team', label: 'Team Meeting', color: '#10B981' },
  { value: 'client', label: 'Client Call', color: '#F59E0B' },
  { value: 'interview', label: 'Interview', color: '#8B5CF6' },
  { value: 'follow-up', label: 'Follow-up', color: '#EF4444' },
  { value: 'personal', label: 'Personal', color: '#6B7280' }
]

const EVENT_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#F97316', // Orange
  '#6B7280'  // Gray
]

export default function EventModal({
  mode = 'create', // create, edit, view
  event = null,
  onSave,
  onEdit,
  onDelete,
  onClose
}) {
  const { user } = useSession()
  const { showToast, ToastContainer } = useToast()

  // Check if user can edit this event (only organizers can edit)
  const canEdit = event?.can_edit !== false;
  const isInvitee = event?.user_role === 'attendee';
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    location: '',
    meeting_type: 'personal',
    color: '#3B82F6',
    attendees: []
  })

  const [errors, setErrors] = useState({})
  const [showAttendeeManagement, setShowAttendeeManagement] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rsvpResponse, setRsvpResponse] = useState(null)
  const [localAttendees, setLocalAttendees] = useState([])

  // Initialize form data when event changes
  useEffect(() => {
    if (event) {
      const startDate = new Date(event.start_time || event.startDate)
      const endDate = new Date(event.end_time || event.endDate)

      setFormData({
        title: event.title || '',
        description: event.description || '',
        start_time: formatDateTimeLocal(startDate),
        end_time: formatDateTimeLocal(endDate),
        location: event.location || '',
        meeting_type: event.meeting_type || 'personal',
        color: event.color || '#3B82F6',
        attendees: event.attendees || []
      })

      // Initialize local attendees state
      setLocalAttendees(event.attendees || [])

      // Set current RSVP response if user is an invitee
      if (isInvitee && event.attendees && user?.email) {
        const currentAttendee = event.attendees.find(att => att.email === user.email)
        if (currentAttendee) {
          setRsvpResponse(currentAttendee.response || 'pending')
        }
      }
    } else {
      // Default times for new events
      const now = new Date()
      const startTime = new Date(now.getTime() + (60 - now.getMinutes()) * 60000) // Round to next hour
      const endTime = new Date(startTime.getTime() + 30 * 60000) // 30 minutes later

      setFormData({
        title: '',
        description: '',
        start_time: formatDateTimeLocal(startTime),
        end_time: formatDateTimeLocal(endTime),
        location: '',
        meeting_type: 'personal',
        color: '#3B82F6',
        attendees: []
      })
    }
  }, [event, isInvitee, user?.email])

  const formatDateTimeLocal = (date) => {
    // Format date for datetime-local input
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }))
    }
  }

  const handleMeetingTypeChange = (type) => {
    const selectedType = MEETING_TYPES.find(t => t.value === type)
    setFormData(prev => ({
      ...prev,
      meeting_type: type,
      color: selectedType?.color || prev.color
    }))
  }

  const validateForm = () => {
    const newErrors = {}

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    }

    if (!formData.start_time) {
      newErrors.start_time = 'Start time is required'
    }

    if (!formData.end_time) {
      newErrors.end_time = 'End time is required'
    }

    if (formData.start_time && formData.end_time) {
      const startDate = new Date(formData.start_time)
      const endDate = new Date(formData.end_time)
      if (endDate <= startDate) {
        newErrors.end_time = 'End time must be after start time'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)
    try {
      await onSave(formData)
    } catch (error) {
      console.error('Error saving event:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (event?.id) {
      setIsSubmitting(true)
      try {
        await onDelete(event.id)
      } catch (error) {
        console.error('Error deleting event:', error)
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const handleRSVP = async (response) => {
    if (!event?.id) return

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/calendar/events/${event.id}/respond`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ response })
      })

      if (!res.ok) throw new Error('Failed to update RSVP')

      const data = await res.json()

      // Update RSVP response state immediately
      setRsvpResponse(response)

      // Update localAttendees to reflect the change immediately
      if (user?.email) {
        const updatedAttendees = localAttendees.map(att =>
          att.email === user.email
            ? { ...att, response, response_time: new Date().toISOString() }
            : att
        )
        setLocalAttendees(updatedAttendees)
      }

      // Show success toast
      const responseText = response === 'accepted' ? 'accepted' : response === 'declined' ? 'declined' : 'marked as tentative for'
      showToast(`You ${responseText} this invitation`, 'success', 3000)

      console.log(`✅ RSVP response updated to: ${response}`)
    } catch (error) {
      console.error('Error updating RSVP:', error)
      showToast('Failed to update your response. Please try again.', 'error', 4000)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isViewMode = mode === 'view' || (mode === 'edit' && !canEdit)
  const isEditMode = mode === 'edit' && canEdit
  const isCreateMode = mode === 'create'

  return (
    <>
      <ToastContainer />
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isCreateMode && 'Create Event'}
            {isEditMode && 'Edit Event'}
            {isViewMode && !isInvitee && event?.title}
            {isViewMode && isInvitee && 'Meeting Invitation'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isViewMode && isInvitee ? (
          // Clean, minimal invitee view (Google/Microsoft style)
          <div className="p-4">
            {/* Title */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{formData.title}</h3>
              {(event?.organizer_name || event?.organizer_email) && (
                <p className="text-xs text-gray-500">
                  {event.organizer_name || event.organizer_email}
                </p>
              )}
            </div>

            {/* Event Details - Simple List */}
            <div className="space-y-3 mb-4 pb-4 border-b border-gray-200">
              {/* Date & Time */}
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">
                    {new Date(formData.start_time).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-500">
                      {new Date(formData.start_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                      {' – '}
                      {new Date(formData.end_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </p>
                    <span className="text-xs text-gray-400">•</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <p className="text-xs text-gray-500">
                        {(() => {
                          const start = new Date(formData.start_time)
                          const end = new Date(formData.end_time)
                          const diffMs = end - start
                          const diffMins = Math.round(diffMs / 60000)
                          const hours = Math.floor(diffMins / 60)
                          const mins = diffMins % 60

                          if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
                          if (hours > 0) return `${hours}h`
                          return `${mins}m`
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Location */}
              {formData.location && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-gray-900">{formData.location}</p>
                </div>
              )}

              {/* Description */}
              {formData.description && (
                <div className="flex items-start gap-3">
                  <Type className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{formData.description}</p>
                </div>
              )}
            </div>

            {/* Participants */}
            {(localAttendees.length > 0 || event?.organizer_email) && (
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  {localAttendees.length + 1} {localAttendees.length === 0 ? 'Participant' : 'Participants'}
                </h4>
                <AttendeeList
                  attendees={localAttendees}
                  organizerName={event.organizer_name}
                  organizerEmail={event.organizer_email}
                />
              </div>
            )}

            {/* RSVP Actions */}
            <div className="pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-3">Attending?</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => handleRSVP('accepted')}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1 transition-all text-sm py-2 h-auto font-medium",
                    rsvpResponse === 'accepted'
                      ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
                  )}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  onClick={() => handleRSVP('declined')}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1 transition-all text-sm py-2 h-auto font-medium",
                    rsvpResponse === 'declined'
                      ? 'bg-red-600 hover:bg-red-700 text-white border-red-600'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
                  )}
                >
                  No
                </Button>
                <Button
                  type="button"
                  onClick={() => handleRSVP('tentative')}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1 transition-all text-sm py-2 h-auto font-medium",
                    rsvpResponse === 'tentative'
                      ? 'bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-600'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
                  )}
                >
                  Maybe
                </Button>
              </div>
              {rsvpResponse && rsvpResponse !== 'pending' && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                  You responded: <span className="font-medium text-gray-700">
                    {rsvpResponse === 'accepted' ? 'Yes' : rsvpResponse === 'declined' ? 'No' : 'Maybe'}
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : (
          // Form view for create/edit modes
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Title */}
            <div>
              <Label htmlFor="title" className="text-sm font-medium text-gray-700 mb-1.5">
                Title *
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="Add title"
                disabled={isViewMode}
                className={`border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.title ? 'border-red-500' : ''}`}
              />
              {errors.title && (
                <p className="text-red-500 text-xs mt-1">{errors.title}</p>
              )}
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="start_time" className="text-sm font-medium text-gray-700 mb-1.5">
                  Start *
                </Label>
                <Input
                  id="start_time"
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => handleInputChange('start_time', e.target.value)}
                  disabled={isViewMode}
                  className={`border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.start_time ? 'border-red-500' : ''}`}
                />
                {errors.start_time && (
                  <p className="text-red-500 text-xs mt-1">{errors.start_time}</p>
                )}
              </div>

              <div>
                <Label htmlFor="end_time" className="text-sm font-medium text-gray-700 mb-1.5">
                  End *
                </Label>
                <Input
                  id="end_time"
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => handleInputChange('end_time', e.target.value)}
                  disabled={isViewMode}
                  className={`border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${errors.end_time ? 'border-red-500' : ''}`}
                />
                {errors.end_time && (
                  <p className="text-red-500 text-xs mt-1">{errors.end_time}</p>
                )}
              </div>
            </div>

            {/* Meeting Type */}
            <div>
              <Label className="text-sm font-medium text-gray-700 mb-1.5">
                Type
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {MEETING_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => handleMeetingTypeChange(type.value)}
                    disabled={isViewMode}
                    className={cn(
                      "py-2 px-3 rounded-md text-xs font-medium transition-colors border",
                      formData.meeting_type === type.value
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
                    )}
                  >
                    <div
                      className="w-2 h-2 rounded-full mx-auto mb-1"
                      style={{ backgroundColor: type.color }}
                    />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Location */}
            <div>
              <Label htmlFor="location" className="text-sm font-medium text-gray-700 mb-1.5">
                Location
              </Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                placeholder="Add location"
                disabled={isViewMode}
                className="border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description" className="text-sm font-medium text-gray-700 mb-1.5">
                Description
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Add description"
                disabled={isViewMode}
                rows={3}
                className="border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Guests/Attendees */}
            {!isViewMode && (
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5">
                  Add Guests
                </Label>
                <div className="space-y-2">
                  {formData.attendees.map((attendee, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={attendee.email}
                        onChange={(e) => {
                          const newAttendees = [...formData.attendees]
                          newAttendees[index].email = e.target.value
                          handleInputChange('attendees', newAttendees)
                        }}
                        placeholder="Email address"
                        className="flex-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <Input
                        type="text"
                        value={attendee.name || ''}
                        onChange={(e) => {
                          const newAttendees = [...formData.attendees]
                          newAttendees[index].name = e.target.value
                          handleInputChange('attendees', newAttendees)
                        }}
                        placeholder="Name (optional)"
                        className="flex-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newAttendees = formData.attendees.filter((_, i) => i !== index)
                          handleInputChange('attendees', newAttendees)
                        }}
                        className="text-gray-400 hover:text-red-600 transition-colors p-2"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      handleInputChange('attendees', [...formData.attendees, { email: '', name: '', role: 'required' }])
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <Users className="w-4 h-4" />
                    Add guest
                  </button>
                </div>
              </div>
            )}

            {/* Attendee List - View Mode Only (for organizers) */}
            {isViewMode && event?.attendees && event.attendees.length > 0 && (
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-3 block">
                  <Users className="w-4 h-4 inline mr-2" />
                  Attendees & Responses
                </Label>
                <AttendeeList
                  attendees={event.attendees}
                  organizerName={event.organizer_name}
                  organizerEmail={event.organizer_email}
                />
              </div>
            )}

            {/* Color Picker */}
            {!isViewMode && (
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1.5">
                  Color
                </Label>
                <div className="flex gap-2">
                  {EVENT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => handleInputChange('color', color)}
                      className={cn(
                        "w-7 h-7 rounded-full border-2 transition-all",
                        formData.color === color
                          ? "border-gray-900 scale-105"
                          : "border-gray-300 hover:scale-105"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-2">
            {(isEditMode || (isViewMode && !isInvitee)) && event?.id && (
              <>
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAttendeeManagement(true)}
                      disabled={isSubmitting}
                      className="text-sm"
                    >
                      <Users className="w-4 h-4 mr-1.5" />
                      Attendees
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={isSubmitting}
                      className="text-sm"
                    >
                      Delete
                    </Button>
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-sm"
            >
              {isViewMode && isInvitee ? 'Close' : 'Cancel'}
            </Button>

            {isViewMode && !isInvitee && canEdit && (
              <Button
                type="button"
                onClick={() => onEdit(event)}
                disabled={isSubmitting}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                Edit
              </Button>
            )}

            {(isCreateMode || isEditMode) && (
              <Button
                type="submit"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? 'Saving...' : (isCreateMode ? 'Create' : 'Save')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Attendee Management Modal */}
      {showAttendeeManagement && event?.id && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
            <AttendeeManagement
              eventId={event.id}
              onClose={() => setShowAttendeeManagement(false)}
              isOrganizer={true}
            />
          </div>
        </div>
      )}

      </div>
    </>
  )
}