/**
 * Tell the operator something happened. NOTIFY_URL is any URL that takes a plain-text POST and pushes it to a
 * phone, such as an ntfy.sh topic (https://ntfy.sh/<a-long-random-topic>). Nothing about a user goes in a message
 * except counts. Failing to notify never fails the thing that triggered it.
 */
export async function notify(env: { NOTIFY_URL?: string }, title: string, message: string) {
  if (!env.NOTIFY_URL) return;
  try {
    await fetch(env.NOTIFY_URL, { method: 'POST', body: message, headers: { Title: title, Priority: 'high' }, signal: AbortSignal.timeout(4000) });
  } catch {}
}
