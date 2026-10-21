import { createApp } from '../supabase-server.js';
const { handler } = createApp();
export default function api(req, res) {
  // Preserve the API route even when the hosting router rewrites the URL.
  const url = new URL(req.url, 'http://localhost');
  const route = req.query?.route || url.searchParams.get('route');
  if (typeof route === 'string') {
    url.searchParams.delete('route');
    req.url = '/api/' + route.replace(/^\/+/, '') + (url.searchParams.size ? '?' + url.searchParams.toString() : '');
  }
  return handler(req, res);
}
