export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface IRequest {
  method: HttpMethod;
  url: string;
  body?: string;
  headers?: { [key: string]: string };
}

export interface SpringEndpoint {
  method: HttpMethod;
  path: string;
  methodName: string;
  className: string;
  parameters: MethodParameter[];
  consumes?: string[];
  produces?: string[];
}

export interface MethodParameter {
  annotation?: string;
  annotationValue?: string;
  type: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}

export interface HttpClientConfig {
  enableCodeLens: boolean;
  useEnvironmentVariables: boolean;
  defaultPort: number;
  defaultHost: string;
  showResponseInNewTab: boolean;
  requestTimeout: number;
}

export interface RequestTemplate {
  name: string;
  method: HttpMethod;
  urlTemplate: string;
  headers?: { [key: string]: string };
  bodyTemplate?: string;
}