export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface IRequest {
  method: HttpMethod;
  url: string;
  body?: string;
  headers?: { [key: string]: string };
}
