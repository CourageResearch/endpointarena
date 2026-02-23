type ApiErrorShape = {
  error?: {
    message?: string
    code?: string
    requestId?: string
  }
}

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const data = payload as ApiErrorShape
    const nestedMessage = data.error?.message
    if (nestedMessage && nestedMessage.trim().length > 0) {
      return nestedMessage
    }

    const legacyMessage = (payload as { message?: string; error?: string }).message
      ?? (payload as { error?: string }).error

    if (typeof legacyMessage === 'string' && legacyMessage.trim().length > 0) {
      return legacyMessage
    }
  }

  return fallback
}

export async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json()
    return getApiErrorMessage(payload, fallback)
  } catch {
    return fallback
  }
}

