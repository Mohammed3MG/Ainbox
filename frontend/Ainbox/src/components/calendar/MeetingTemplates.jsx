import { useState, useEffect } from 'react'
import {
  Plus,
  Edit,
  Trash2,
  Clock,
  Users,
  Calendar,
  Repeat,
  TrendingUp,
  Copy,
  Play
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

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'No recurrence' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]

export default function MeetingTemplates({ onCreateEvent, onClose }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    meeting_type: 'personal',
    default_duration: 30,
    default_agenda: '',
    default_location: '',
    recurrence_pattern: 'none',
    attendee_emails: []
  })

  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/calendar/templates', {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setTemplates(data.templates || [])
      } else {
        console.error('Failed to load templates')
        setTemplates([])
      }
    } catch (error) {
      console.error('Error loading templates:', error)
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTemplate = async (e) => {
    e.preventDefault()

    try {
      const response = await fetch('/api/calendar/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData)
      })

      if (response.ok) {
        const data = await response.json()
        setTemplates(prev => [...prev, data.template])
        setShowCreateForm(false)
        resetForm()
      } else {
        const error = await response.json()
        alert('Failed to create template: ' + error.message)
      }
    } catch (error) {
      console.error('Error creating template:', error)
      alert('Failed to create template')
    }
  }

  const handleUpdateTemplate = async (e) => {
    e.preventDefault()

    try {
      const response = await fetch(`/api/calendar/templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData)
      })

      if (response.ok) {
        const data = await response.json()
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? data.template : t))
        setEditingTemplate(null)
        resetForm()
      } else {
        const error = await response.json()
        alert('Failed to update template: ' + error.message)
      }
    } catch (error) {
      console.error('Error updating template:', error)
      alert('Failed to update template')
    }
  }

  const handleDeleteTemplate = async (templateId) => {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      const response = await fetch(`/api/calendar/templates/${templateId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (response.ok) {
        setTemplates(prev => prev.filter(t => t.id !== templateId))
      } else {
        alert('Failed to delete template')
      }
    } catch (error) {
      console.error('Error deleting template:', error)
      alert('Failed to delete template')
    }
  }

  const handleUseTemplate = async (template) => {
    // Create event from template
    const now = new Date()
    const startTime = new Date(now.getTime() + (60 - now.getMinutes()) * 60000) // Round to next hour
    const endTime = new Date(startTime.getTime() + template.default_duration * 60000)

    const eventData = {
      title: template.name,
      description: template.default_agenda,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      location: template.default_location,
      meeting_type: template.meeting_type,
      template_id: template.id,
      attendees: template.attendee_emails?.map(email => ({
        email,
        role: 'required'
      })) || []
    }

    if (onCreateEvent) {
      onCreateEvent(eventData)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      meeting_type: 'personal',
      default_duration: 30,
      default_agenda: '',
      default_location: '',
      recurrence_pattern: 'none',
      attendee_emails: []
    })
    setShowCreateForm(false)
    setEditingTemplate(null)
  }

  const startEdit = (template) => {
    setFormData({
      name: template.name,
      meeting_type: template.meeting_type,
      default_duration: template.default_duration,
      default_agenda: template.default_agenda || '',
      default_location: template.default_location || '',
      recurrence_pattern: template.recurrence_pattern || 'none',
      attendee_emails: template.attendee_emails || []
    })
    setEditingTemplate(template)
    setShowCreateForm(true)
  }

  const getMeetingTypeColor = (type) => {
    const meetingType = MEETING_TYPES.find(t => t.value === type)
    return meetingType?.color || '#6B7280'
  }

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
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Meeting Templates</h2>
          <p className="text-gray-600 mt-1">Create reusable templates for common meetings</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingTemplate ? 'Edit Template' : 'Create New Template'}
          </h3>

          <form onSubmit={editingTemplate ? handleUpdateTemplate : handleCreateTemplate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Weekly 1:1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="meeting_type">Meeting Type</Label>
                <select
                  id="meeting_type"
                  value={formData.meeting_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, meeting_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {MEETING_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="duration">Default Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min="5"
                  max="480"
                  value={formData.default_duration}
                  onChange={(e) => setFormData(prev => ({ ...prev, default_duration: parseInt(e.target.value) }))}
                />
              </div>

              <div>
                <Label htmlFor="location">Default Location</Label>
                <Input
                  id="location"
                  value={formData.default_location}
                  onChange={(e) => setFormData(prev => ({ ...prev, default_location: e.target.value }))}
                  placeholder="e.g., Conference Room A"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="agenda">Default Agenda</Label>
              <Textarea
                id="agenda"
                value={formData.default_agenda}
                onChange={(e) => setFormData(prev => ({ ...prev, default_agenda: e.target.value }))}
                placeholder="Enter default agenda items..."
                rows={3}
              />
            </div>

            <div className="flex gap-3">
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                {editingTemplate ? 'Update Template' : 'Create Template'}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Templates Grid */}
      {templates.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Templates Yet</h3>
          <p className="text-gray-500 mb-4">Create your first meeting template to save time scheduling.</p>
          <Button onClick={() => setShowCreateForm(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Create First Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <div key={template.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              {/* Template Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 truncate">{template.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: getMeetingTypeColor(template.meeting_type) }}
                    />
                    <span className="text-sm text-gray-500 capitalize">
                      {template.meeting_type.replace('-', ' ')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(template)}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Template Details */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>{template.default_duration} minutes</span>
                </div>

                {template.default_location && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span className="truncate">{template.default_location}</span>
                  </div>
                )}

                {template.attendee_emails && template.attendee_emails.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Users className="w-4 h-4" />
                    <span>{template.attendee_emails.length} default attendees</span>
                  </div>
                )}

                {template.usage_count !== undefined && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <TrendingUp className="w-4 h-4" />
                    <span>Used {template.usage_count} times</span>
                  </div>
                )}
              </div>

              {/* Agenda Preview */}
              {template.default_agenda && (
                <div className="mb-4">
                  <p className="text-sm text-gray-700 line-clamp-3">
                    {template.default_agenda}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleUseTemplate(template)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="w-4 h-4 mr-1" />
                  Use Template
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startEdit(template)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}