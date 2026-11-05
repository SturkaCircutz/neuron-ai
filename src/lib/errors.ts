export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message?: string) => new HttpError(400, 'bad_request', message);
export const unauthorized = (code = 'unauthorized') => new HttpError(401, code);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
export const notFound = (what = 'resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string) => new HttpError(409, code);
