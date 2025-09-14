import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // TODO: handle global errors (e.g., 401 redirects)
    return Promise.reject(error)
  },
)

export const get = (url, config) => api.get(url, config).then((r) => r.data)
export const post = (url, data, config) =>
  api.post(url, data, config).then((r) => r.data)
export const patch = (url, data, config) =>
  api.patch(url, data, config).then((r) => r.data)
export const del = (url, config) => api.delete(url, config).then((r) => r.data)

