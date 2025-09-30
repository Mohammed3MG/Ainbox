import { useState, useEffect } from 'react'
import {
  Mail,
  Calendar,
  Clock,
  MapPin,
  Users,
  Sparkles,
  AlertCircle,
  Check,
  X,
  Edit,
  ArrowRight,
  FileText,
  Zap
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'

const MEETING_TYPES = [
  { value: 'one-on-one', label: 'One-on-one', color: '#3B82F6' },
  { value: 'team', label: 'Team Meeting', color: '#10B981' },
  { value: 'client', label: 'Client Call', color: '#F59E0B' },
  { value: 'interview', label: 'Interview', color: '#8B5CF6' },
  { value: 'follow-up', label: 'Follow-up', color: '#EF4444' },
  { value: 'personal', label: 'Personal', color: '#6B7280' }
]

export default function EmailToEventConverter({
  emailContent,
  emailId = null,
  messageId = null,
  onEventCreate,
  onClose
}) {
  const [step, setStep] = useState(1) // 1: preview, 2: customize, 3: confirm
  const [loading, setLoading] = useState(false)
  const [extractedData, setExtractedData] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [eventData, setEventData] = useState({
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    location: '',
    meeting_type: 'personal',
    attendees: []
  })

  useEffect(() => {
    if (emailContent) {
      convertEmail()
    }
  }, [emailContent])

  const convertEmail = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/calendar/convert-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailId,
          messageId,
          emailContent
        })
      })

      if (response.ok) {
        const data = await response.json()
        setExtractedData(data.event_data)
        setEventData(data.event_data)

        // Also get suggestions
        await getSuggestions()
      } else {
        console.error('Failed to convert email')
      }
    } catch (error) {
      console.error('Error converting email:', error)
    } finally {
      setLoading(false)
    }
  }

  const getSuggestions = async () => {
    try {
      const response = await fetch('/api/calendar/email-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emailContent })
      })

      if (response.ok) {
        const data = await response.json()
        setSuggestions(data.suggestions)
      }
    } catch (error) {
      console.error('Error getting suggestions:', error)
    }
  }

  const handleEventDataChange = (field, value) => {
    setEventData(prev => ({ ...prev, [field]: value }))
  }

  const handleCreateEvent = async () => {
    setLoading(true)
    try {
      if (onEventCreate) {
        await onEventCreate(eventData)
      }
    } catch (error) {
      console.error('Error creating event:', error)
    } finally {
      setLoading(false)
    }
  }

  const applySuggestion = (field, value) => {
    handleEventDataChange(field, value)
  }

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'Not specified'
    return new Date(dateTime).toLocaleString()
  }

  if (loading && step === 1) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Analyzing email with AI...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Convert Email to Event</h2>
            <p className="text-gray-600">AI-powered email to calendar conversion</p>
          </div>
        </div>
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center space-x-4">
          {[1, 2, 3].map((stepNumber) => (
            <div key={stepNumber} className="flex items-center">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium",
                step >= stepNumber
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-600"
              )}>
                {step > stepNumber ? <Check className="w-5 h-5" /> : stepNumber}
              </div>
              {stepNumber < 3 && (
                <ArrowRight className={cn(
                  "w-5 h-5 mx-2",
                  step > stepNumber ? "text-blue-600" : "text-gray-400"
                )} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: AI Preview */}
      {step === 1 && extractedData && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-blue-900">AI Extracted Information</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-blue-800">Event Title</Label>
                <p className="text-blue-900 font-medium">{extractedData.title || 'Not specified'}</p>
              </div>

              <div>
                <Label className="text-sm font-medium text-blue-800">Meeting Type</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: MEETING_TYPES.find(t => t.value === extractedData.meeting_type)?.color }}
                  />
                  <span className="text-blue-900 capitalize">
                    {MEETING_TYPES.find(t => t.value === extractedData.meeting_type)?.label || extractedData.meeting_type}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium text-blue-800">Start Time</Label>
                <p className="text-blue-900">{formatDateTime(extractedData.start_time)}</p>
              </div>

              <div>
                <Label className="text-sm font-medium text-blue-800">End Time</Label>
                <p className="text-blue-900">{formatDateTime(extractedData.end_time)}</p>
              </div>

              <div className="md:col-span-2">
                <Label className="text-sm font-medium text-blue-800">Location</Label>
                <p className="text-blue-900">{extractedData.location || 'Not specified'}</p>
              </div>

              <div className="md:col-span-2">
                <Label className="text-sm font-medium text-blue-800">Description</Label>
                <p className="text-blue-900">{extractedData.description || 'No description provided'}</p>
              </div>

              {extractedData.attendees && extractedData.attendees.length > 0 && (
                <div className="md:col-span-2">
                  <Label className="text-sm font-medium text-blue-800">Attendees</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {extractedData.attendees.map((attendee, index) => (
                      <Badge key={index} variant="secondary" className="bg-blue-100 text-blue-800">
                        {attendee.name || attendee.email}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Suggestions */}
          {suggestions && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">AI Suggestions</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggestions.titles && suggestions.titles.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Alternative Titles</Label>
                    <div className="space-y-1">
                      {suggestions.titles.slice(0, 3).map((title, index) => (
                        <button
                          key={index}
                          onClick={() => applySuggestion('title', title)}
                          className="block w-full text-left px-3 py-2 bg-white border border-gray-200 rounded-md hover:bg-gray-50 text-sm"
                        >
                          {title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {suggestions.durations && suggestions.durations.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Suggested Durations</Label>
                    <div className="flex gap-2 flex-wrap">
                      {suggestions.durations.map((duration, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="cursor-pointer hover:bg-gray-100"
                          onClick={() => {
                            if (eventData.start_time) {
                              const startTime = new Date(eventData.start_time)
                              const endTime = new Date(startTime.getTime() + duration * 60000)
                              applySuggestion('end_time', endTime.toISOString())
                            }
                          }}
                        >
                          {duration} min
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <Button
              onClick={() => setStep(2)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Edit className="w-4 h-4 mr-2" />
              Customize Event
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Customize */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Customize Event Details</h3>

            <div className="space-y-4">
              <div>
                <Label htmlFor="title">Event Title *</Label>
                <Input
                  id="title"
                  value={eventData.title}
                  onChange={(e) => handleEventDataChange('title', e.target.value)}
                  placeholder="Enter event title"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start_time">Start Time *</Label>
                  <Input
                    id="start_time"
                    type="datetime-local"
                    value={eventData.start_time ? eventData.start_time.slice(0, 16) : ''}
                    onChange={(e) => handleEventDataChange('start_time', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="end_time">End Time *</Label>
                  <Input
                    id="end_time"
                    type="datetime-local"
                    value={eventData.end_time ? eventData.end_time.slice(0, 16) : ''}
                    onChange={(e) => handleEventDataChange('end_time', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Meeting Type</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {MEETING_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => handleEventDataChange('meeting_type', type.value)}
                      className={cn(
                        "p-3 rounded-lg border text-sm font-medium transition-colors",
                        eventData.meeting_type === type.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      )}
                    >
                      <div
                        className="w-3 h-3 rounded-full mx-auto mb-1"
                        style={{ backgroundColor: type.color }}
                      />
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={eventData.location}
                  onChange={(e) => handleEventDataChange('location', e.target.value)}
                  placeholder="Add location (optional)"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={eventData.description}
                  onChange={(e) => handleEventDataChange('description', e.target.value)}
                  placeholder="Add description (optional)"
                  rows={3}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Review & Create
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Check className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-green-900">Ready to Create Event</h3>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-900">{eventData.title}</span>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-green-600" />
                <span className="text-green-800">
                  {formatDateTime(eventData.start_time)} - {formatDateTime(eventData.end_time)}
                </span>
              </div>

              {eventData.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-green-600" />
                  <span className="text-green-800">{eventData.location}</span>
                </div>
              )}

              {eventData.attendees && eventData.attendees.length > 0 && (
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-green-600" />
                  <span className="text-green-800">{eventData.attendees.length} attendees</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(2)}
            >
              Back to Edit
            </Button>
            <Button
              onClick={handleCreateEvent}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700"
            >
              {loading ? 'Creating...' : 'Create Event'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}