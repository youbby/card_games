/**
 * The one rule for showing errors: only the message itself, never an
 * "Error:" prefix. Unknown values get a generic Korean message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '알 수 없는 오류가 발생했습니다.';
}
