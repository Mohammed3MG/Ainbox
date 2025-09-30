import { useState, useEffect } from 'react'
import {
  Users,
  Plus,
  Trash2,
  Check,
  X,
  Clock,
  AlertCircle,
  Mail,
  UserPlus,
  CheckCircle,
  XCircle
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'

const RESPONSE_STYLES = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock },
  accepted: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
  declined: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle },
  tentative: { bg: 'bg-blue-100', text: 'text-blue-800', icon: AlertCircle }
}

export default function AttendeeManagement({ eventId, onClose, isOrganizer = false }) {
  const [attendees, setAttendees] = useState([])
  const [responseSummary, setResponseSummary] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newAttendee, setNewAttendee] = useState({ email: '', name: '', role: 'required' })
  const [userRole, setUserRole] = useState('attendee')

  useEffect(() => {
    if (eventId) {
      loadAttendees()
    }
  }, [eventId])

  const loadAttendees = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/calendar/events/${eventId}/attendees`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setAttendees(data.attendees || [])
        setResponseSummary(data.response_summary || {})
        setUserRole(data.user_role || 'attendee')
      } else {
        console.error('Failed to load attendees')
      }
    } catch (error) {
      console.error('Error loading attendees:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddAttendee = async (e) => {
    e.preventDefault()

    if (!newAttendee.email) return

    try {
      const response = await fetch(`/api/calendar/events/${eventId}/attendees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newAttendee)
      })

      if (response.ok) {
        setNewAttendee({ email: '', name: '', role: 'required' })
        setShowAddForm(false)
        await loadAttendees()
      } else {
        const error = await response.json()
        alert('Failed to add attendee: ' + error.message)
      }
    } catch (error) {
      console.error('Error adding attendee:', error)
      alert('Failed to add attendee')
    }
  }

  const handleRemoveAttendee = async (attendeeId, email) => {
    if (!confirm(`Remove ${email} from this event?`)) return

    try {
      const response = await fetch(`/api/calendar/events/${eventId}/attendees/${attendeeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (response.ok) {
        await loadAttendees()
      } else {
        alert('Failed to remove attendee')
      }
    } catch (error) {
      console.error('Error removing attendee:', error)
      alert('Failed to remove attendee')
    }
  }

  const handleRSVPUpdate = async (attendeeId, response, note = '') => {
    try {
      const updateResponse = await fetch(`/api/calendar/events/${eventId}/attendees/${attendeeId}/rsvp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response, response_note: note })
      })

      if (updateResponse.ok) {
        await loadAttendees()
      } else {
        const error = await updateResponse.json()
        alert('Failed to update RSVP: ' + error.message)
      }
    } catch (error) {
      console.error('Error updating RSVP:', error)
      alert('Failed to update RSVP')
    }
  }

  const getResponseIcon = (response) => {
    const config = RESPONSE_STYLES[response] || RESPONSE_STYLES.pending
    const Icon = config.icon
    return <Icon className="w-4 h-4" />
  }

  const canManageAttendees = userRole === 'organizer' || isOrganizer

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Event Attendees</h2>
            <p className="text-gray-600">{attendees.length} total attendees</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canManageAttendees && (
            <Button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Add Attendee
            </Button>
          )}
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Response Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Object.entries(responseSummary).map(([response, count]) => {
          const config = RESPONSE_STYLES[response] || RESPONSE_STYLES.pending
          return (
            <div key={response} className={cn(
              "p-4 rounded-lg border",
              config.bg
            )}>
              <div className="flex items-center gap-2 mb-1">
                {getResponseIcon(response)}
                <span className={cn("text-sm font-medium capitalize", config.text)}>
                  {response}
                </span>
              </div>
              <div className={cn("text-2xl font-bold", config.text)}>
                {count}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Attendee Form */}
      {showAddForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Add New Attendee</h3>

          <form onSubmit={handleAddAttendee} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={newAttendee.email}
                  onChange={(e) => setNewAttendee(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="attendee@example.com"
                  required
                />
              </div>

              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={newAttendee.name}
                  onChange={(e) => setNewAttendee(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Full Name"
                />
              </div>

              <div>
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  value={newAttendee.role}
                  onChange={(e) => setNewAttendee(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                  <option value="resource">Resource</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Attendee
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Attendees List */}
      <div className="space-y-4">
        {attendees.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Attendees Yet</h3>
            <p className="text-gray-500 mb-4">Add attendees to this event to track RSVPs.</p>
            {canManageAttendees && (
              <Button onClick={() => setShowAddForm(true)} className="bg-blue-600 hover:bg-blue-700">
                <UserPlus className="w-4 h-4 mr-2" />
                Add First Attendee
              </Button>
            )}
          </div>
        ) : (
          attendees.map((attendee) => {
            const config = RESPONSE_STYLES[attendee.response] || RESPONSE_STYLES.pending
            const isCurrentUser = attendee.email === localStorage.getItem('userEmail')

            return (
              <div key={attendee.id} className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      {attendee.avatar_url ? (
                        <img
                          src={attendee.avatar_url}
                          alt={attendee.name || attendee.email}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-gray-600 font-medium text-sm">
                          {(attendee.name || attendee.email).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Attendee Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-gray-900">
                          {attendee.name || attendee.email}
                        </h4>
                        {isCurrentUser && (
                          <Badge variant="outline" className="text-xs">You</Badge>
                        )}
                        {attendee.role !== 'required' && (
                          <Badge variant="secondary" className="text-xs capitalize">
                            {attendee.role}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="w-4 h-4" />
                        <span>{attendee.email}</span>
                      </div>
                      {attendee.response_note && (
                        <p className="text-sm text-gray-600 mt-1">
                          Note: {attendee.response_note}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Response Status & Actions */}
                  <div className="flex items-center gap-3">
                    {/* Current Response */}
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-full",
                      config.bg
                    )}>
                      {getResponseIcon(attendee.response)}
                      <span className={cn("text-sm font-medium capitalize", config.text)}>
                        {attendee.response}
                      </span>
                    </div>

                    {/* RSVP Actions (for current user or organizer) */}
                    {(isCurrentUser || canManageAttendees) && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleRSVPUpdate(attendee.id, 'accepted')}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                          title="Accept"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRSVPUpdate(attendee.id, 'declined')}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Decline"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRSVPUpdate(attendee.id, 'tentative')}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="Tentative"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Remove Attendee (organizer only) */}
                    {canManageAttendees && !isCurrentUser && (
                      <button
                        onClick={() => handleRemoveAttendee(attendee.id, attendee.email)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Remove attendee"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Response Details */}
                {(attendee.responded_at || attendee.invited_at) && (
                  <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                    {attendee.responded_at ? (
                      <span>Responded: {new Date(attendee.responded_at).toLocaleDateString()}</span>
                    ) : (
                      <span>Invited: {new Date(attendee.invited_at).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}