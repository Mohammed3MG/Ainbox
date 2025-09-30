import { useState, useEffect } from 'react'
import {
  Home,
  Users,
  Monitor,
  Wifi,
  Coffee,
  Calendar,
  MapPin,
  Clock,
  Search,
  Filter,
  Check,
  X,
  AlertCircle
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'

const ROOM_AMENITIES_ICONS = {
  projector: Monitor,
  wifi: Wifi,
  coffee: Coffee,
  whiteboard: Filter,
  video_conference: Users
}

export default function RoomBooking({
  startTime,
  endTime,
  onRoomSelect,
  selectedRoomId = null,
  onClose
}) {
  const [rooms, setRooms] = useState([])
  const [availableRooms, setAvailableRooms] = useState([])
  const [unavailableRooms, setUnavailableRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [capacityFilter, setCapacityFilter] = useState('')
  const [showUnavailable, setShowUnavailable] = useState(false)

  useEffect(() => {
    if (startTime && endTime) {
      loadRoomAvailability()
    }
  }, [startTime, endTime])

  const loadRoomAvailability = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        start_time: startTime,
        end_time: endTime
      })

      if (capacityFilter) {
        params.append('capacity', capacityFilter)
      }

      const response = await fetch(`/api/calendar/rooms/available?${params}`, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setAvailableRooms(data.available_rooms || [])
        setUnavailableRooms(data.unavailable_rooms || [])
        setRooms([...data.available_rooms, ...data.unavailable_rooms])
      } else {
        console.error('Failed to load room availability')
        setAvailableRooms([])
        setUnavailableRooms([])
      }
    } catch (error) {
      console.error('Error loading room availability:', error)
      setAvailableRooms([])
      setUnavailableRooms([])
    } finally {
      setLoading(false)
    }
  }

  const handleRoomSelect = (room) => {
    if (onRoomSelect) {
      onRoomSelect(room)
    }
  }

  const filteredAvailableRooms = availableRooms.filter(room => {
    const matchesSearch = room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         room.location?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCapacity = !capacityFilter || room.capacity >= parseInt(capacityFilter)
    return matchesSearch && matchesCapacity
  })

  const filteredUnavailableRooms = unavailableRooms.filter(room => {
    const matchesSearch = room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         room.location?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCapacity = !capacityFilter || room.capacity >= parseInt(capacityFilter)
    return matchesSearch && matchesCapacity
  })

  const renderRoomCard = (room, isAvailable = true) => {
    const isSelected = selectedRoomId === room.id

    return (
      <div
        key={room.id}
        className={cn(
          "border rounded-lg p-4 transition-all cursor-pointer",
          isAvailable
            ? "border-gray-200 hover:border-blue-300 hover:shadow-md"
            : "border-red-200 bg-red-50 opacity-60",
          isSelected && "border-blue-500 bg-blue-50 shadow-md"
        )}
        onClick={() => isAvailable && handleRoomSelect(room)}
      >
        {/* Room Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={cn(
                "font-semibold",
                isAvailable ? "text-gray-900" : "text-red-700"
              )}>
                {room.name}
              </h3>
              {isSelected && isAvailable && (
                <Badge className="bg-blue-100 text-blue-800">
                  <Check className="w-3 h-3 mr-1" />
                  Selected
                </Badge>
              )}
              {!isAvailable && (
                <Badge variant="destructive">
                  <X className="w-3 h-3 mr-1" />
                  Unavailable
                </Badge>
              )}
            </div>

            {room.location && (
              <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
                <MapPin className="w-4 h-4" />
                <span>{room.location}</span>
              </div>
            )}
          </div>

          <div className="text-right">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Users className="w-4 h-4" />
              <span>{room.capacity} people</span>
            </div>
          </div>
        </div>

        {/* Room Details */}
        {room.description && (
          <p className="text-sm text-gray-600 mb-3">{room.description}</p>
        )}

        {/* Amenities */}
        {room.amenities && room.amenities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {room.amenities.map((amenity) => {
              const Icon = ROOM_AMENITIES_ICONS[amenity] || Filter
              return (
                <div
                  key={amenity}
                  className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-md text-xs text-gray-700"
                >
                  <Icon className="w-3 h-3" />
                  <span className="capitalize">{amenity.replace('_', ' ')}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Action Button */}
        {isAvailable ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleRoomSelect(room)
            }}
            className={cn(
              "w-full",
              isSelected
                ? "bg-green-600 hover:bg-green-700"
                : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {isSelected ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                Selected
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4 mr-2" />
                Select Room
              </>
            )}
          </Button>
        ) : (
          <div className="w-full text-center py-2 text-sm text-red-600 font-medium">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            Room is booked during this time
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const timeSlot = `${new Date(startTime).toLocaleString()} - ${new Date(endTime).toLocaleString()}`

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Conference Room Booking</h2>
          <div className="flex items-center gap-2 text-gray-600 mt-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm">{timeSlot}</span>
          </div>
        </div>
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <Label htmlFor="search">Search Rooms</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              id="search"
              placeholder="Search by name or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="capacity">Minimum Capacity</Label>
          <Input
            id="capacity"
            type="number"
            placeholder="Number of people"
            value={capacityFilter}
            onChange={(e) => setCapacityFilter(e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <Button
            variant="outline"
            onClick={() => setShowUnavailable(!showUnavailable)}
            className={cn(
              "w-full",
              showUnavailable && "bg-gray-100"
            )}
          >
            {showUnavailable ? 'Hide' : 'Show'} Unavailable Rooms
          </Button>
        </div>
      </div>

      {/* Room Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-700">{filteredAvailableRooms.length}</div>
          <div className="text-sm text-green-600">Available</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-700">{filteredUnavailableRooms.length}</div>
          <div className="text-sm text-red-600">Unavailable</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-700">{rooms.length}</div>
          <div className="text-sm text-blue-600">Total Rooms</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-gray-700">
            {selectedRoomId ? '1' : '0'}
          </div>
          <div className="text-sm text-gray-600">Selected</div>
        </div>
      </div>

      {/* Available Rooms */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Available Rooms ({filteredAvailableRooms.length})
        </h3>

        {filteredAvailableRooms.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Home className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No Available Rooms</h4>
            <p className="text-gray-500">
              No rooms match your criteria for the selected time slot.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAvailableRooms.map((room) => renderRoomCard(room, true))}
          </div>
        )}
      </div>

      {/* Unavailable Rooms */}
      {showUnavailable && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Unavailable Rooms ({filteredUnavailableRooms.length})
          </h3>

          {filteredUnavailableRooms.length === 0 ? (
            <div className="text-center py-8 bg-green-50 rounded-lg">
              <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-green-700 font-medium">All rooms are available!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredUnavailableRooms.map((room) => renderRoomCard(room, false))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}