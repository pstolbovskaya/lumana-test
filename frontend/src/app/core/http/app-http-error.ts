import { HttpErrorResponse } from '@angular/common/http';

export interface AppHttpError {
  status: number;
  message: string;
}

export function toAppHttpError(error: unknown): AppHttpError {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return { status: 0, message: 'Network error — check your connection and try again.' };
    }
    if (error.status === 429) {
      return {
        status: 429,
        message: 'The game deals service is rate-limiting us — wait a few seconds, then try again.',
      };
    }
    if (error.status >= 500) {
      return { status: error.status, message: 'The game deals service (CheapShark) is temporarily unavailable.' };
    }
    const apiMessage =
      typeof error.error === 'object' && error.error !== null && 'error' in error.error
        ? String((error.error as { error: unknown }).error)
        : null;
    return { status: error.status, message: apiMessage ?? `Request failed (${error.status}).` };
  }
  if (typeof error === 'object' && error !== null && 'message' in error && 'status' in error) {
    return error as AppHttpError;
  }
  return { status: -1, message: 'Unexpected error.' };
}
