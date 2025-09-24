-- KEYS[1] = recent_local_change_until
-- ARGV[1] = newUntilTs (epoch ms)
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local incoming = tonumber(ARGV[1])
if incoming > current then
  redis.call('SET', KEYS[1], incoming)
  return incoming
end
return current