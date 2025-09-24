-- KEYS[1] = unread_count key
-- ARGV[1] = delta (integer)
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local delta = tonumber(ARGV[1])
local next = current + delta
if next < 0 then next = 0 end
redis.call('SET', KEYS[1], next)
return next