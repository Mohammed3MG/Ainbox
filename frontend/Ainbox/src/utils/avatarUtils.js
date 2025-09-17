// Utility functions for generating dynamic avatars with initials and colors

// Predefined color palette for avatars
const AVATAR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-green-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-sky-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-fuchsia-500',
  'bg-pink-500',
  'bg-rose-500',
  'bg-slate-500',
  'bg-gray-500',
  'bg-zinc-500'
]

/**
 * Generate initials from a full name
 * @param {string} name - The full name
 * @returns {string} - The initials (max 2 characters)
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return '?'

  // Clean the name and split into words
  const words = name.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) {
    // Single word - take first two characters
    return words[0].substring(0, 2).toUpperCase()
  }

  // Multiple words - take first character of first and last word
  const firstInitial = words[0].charAt(0)
  const lastInitial = words[words.length - 1].charAt(0)

  return (firstInitial + lastInitial).toUpperCase()
}

/**
 * Generate a consistent color for a given string (usually email or name)
 * @param {string} seed - The seed string to generate color from
 * @returns {string} - Tailwind CSS background color class
 */
export function getAvatarColor(seed) {
  if (!seed || typeof seed !== 'string') return AVATAR_COLORS[0]

  // Simple hash function to convert string to number
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }

  // Use absolute value and modulo to get consistent index
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]
}

/**
 * Generate avatar props for a person
 * @param {string} name - The person's name
 * @param {string} email - The person's email (used for color consistency)
 * @returns {object} - Object with initials, colorClass, and textColor
 */
export function generateAvatarProps(name, email) {
  const initials = getInitials(name)
  const colorClass = getAvatarColor(email || name)

  return {
    initials,
    colorClass,
    textColor: 'text-white' // All backgrounds are dark enough for white text
  }
}

/**
 * Check if an email has a profile image URL
 * @param {string} avatarUrl - The avatar URL to check
 * @returns {boolean} - Whether the URL is valid and not a placeholder
 */
export function hasValidAvatar(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return false

  // Check if it's a placeholder URL (like pravatar.cc or similar)
  const placeholderDomains = ['pravatar.cc', 'ui-avatars.com', 'avatar.vercel.sh']
  const url = avatarUrl.toLowerCase()

  return !placeholderDomains.some(domain => url.includes(domain))
}