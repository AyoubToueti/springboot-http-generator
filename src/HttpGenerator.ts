import * as vscode from 'vscode';
import { IRequest, HttpMethod } from './types';
import { BodyGenerator } from './BodyGenerator';
import axios, { AxiosRequestConfig } from 'axios';

interface SpringMapping {
  method: HttpMethod;
  path: string;
  consumes?: string[];
  produces?: string[];
}

interface MethodParameter {
  annotation?: string;
  type: string;
  name: string;
  value?: string;
}

export class HttpGenerator {
  private static readonly GENERATION_TIMEOUT = 10000; // 10 seconds
  private static readonly MAX_URL_LENGTH = 2048;
  
  public static async generate(document: vscode.TextDocument, range: vscode.Range): Promise<IRequest | undefined> {
    try {
      // Add timeout to prevent hanging
      return await Promise.race([
        this.generateInternal(document, range),
        new Promise<IRequest | undefined>((_, reject) => 
          setTimeout(() => reject(new Error('Request generation timeout')), this.GENERATION_TIMEOUT)
        )
      ]);
    } catch (error) {
      console.error('Error generating HTTP request:', error);
      if (error instanceof Error && error.message.includes('timeout')) {
        vscode.window.showErrorMessage('Request generation timed out - the code structure may be too complex');
      } else {
        vscode.window.showErrorMessage(`Failed to generate HTTP request: ${error}`);
      }
      return undefined;
    }
  }

  private static async generateInternal(document: vscode.TextDocument, range: vscode.Range): Promise<IRequest | undefined> {
    const text = document.getText(range);
    const fullText = document.getText();
    
    if (!text.trim() || text.length > 10000) throw new Error('Invalid or too large code selection');

    const mapping = this.extractMappingInfo(text);
    if (!mapping) throw new Error('Could not parse Spring mapping annotation');

    const classMapping = this.extractClassMapping(fullText, range.start.line);
    
    const methodInfo = this.extractMethodInfo(text);
    if (!methodInfo) throw new Error('Could not parse method signature');

    const basePath = classMapping || '';
    const fullPath = this.combinePaths(basePath, mapping.path);
    
    const { url, body, headers } = await this.processMethodParameters(methodInfo.parameters, fullPath, mapping.method);

    if (url.length > this.MAX_URL_LENGTH) throw new Error('Generated URL is too long');

    const finalHeaders = { ...headers };
    if (body && !finalHeaders['Content-Type']) finalHeaders['Content-Type'] = mapping.consumes?.[0] || 'application/json';
    if (!finalHeaders['Accept']) finalHeaders['Accept'] = mapping.produces?.[0] || 'application/json';

    const { port, contextPath } = await this.detectServerConfig();
    const baseUrl = `http://localhost:${port}${contextPath}`;
    const finalUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;

    return {
      method: mapping.method,
      url: finalUrl,
      body: body,
      headers: finalHeaders
    };
  }

  private static extractMappingInfo(annotationText: string): SpringMapping | undefined {
    try {
      const normalizedText = annotationText.replace(/\s+/g, ' ').trim();
      const patterns = [
        /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\)/,
        /@RequestMapping\s*\([^)]*method\s*=\s*RequestMethod\.(\w+)[^)]*,?\s*(?:path|value)\s*=\s*"([^"]*)"[^)]*\)/,
        /@RequestMapping\s*\([^)]*(?:path|value)\s*=\s*"([^"]*)"[^)]*,?\s*method\s*=\s*RequestMethod\.(\w+)[^)]*\)/,
        /@RequestMapping\s*\(\s*"([^"]*)"\s*\)/,
        /@(Get|Post|Put|Delete|Patch)Mapping/
      ];

      const matchResult = this.matchSpringMappingPattern(normalizedText, patterns);
      if (!matchResult) return undefined;

      const { method, path } = matchResult;
      const consumes = this.extractArrayAttribute(normalizedText, 'consumes');
      const produces = this.extractArrayAttribute(normalizedText, 'produces');
      return { method, path, consumes, produces };
    } catch (error) {
      console.error('Error extracting mapping info:', error);
    }
    return undefined;
  }

  private static matchSpringMappingPattern(
    normalizedText: string,
    patterns: RegExp[]
  ): { method: HttpMethod; path: string } | undefined {
    for (const pattern of patterns) {
      const match = pattern.exec(normalizedText);
      if (!match) continue;

      let method: HttpMethod;
      let path: string;

      if (normalizedText.includes('RequestMapping')) {
        if (match[1] && match[2]) {
          method = match[1].toUpperCase() as HttpMethod;
          path = match[2] || '';
        } else if (match[1] && !match[2]) {
          method = 'GET';
          path = match[1];
        } else {
          method = match[2].toUpperCase() as HttpMethod;
          path = match[1] || '';
        }
      } else {
        method = match[1].toUpperCase() as HttpMethod;
        path = match[2] || '';
      }
      return { method, path };
    }
    return undefined;
  }

  private static extractArrayAttribute(text: string, attribute: string): string[] | undefined {
    try {
      const pattern = new RegExp(`${attribute}\\s*=\\s*\\{([^}]+)\\}`, 'i');
      const match = pattern.exec(text);
      if (match) {
        return match[1].split(',')
          .map(s => s.trim().replace(/"/g, ''))
          .filter(s => s.length > 0);
      }

      const singlePattern = new RegExp(`${attribute}\\s*=\\s*"([^"]+)"`, 'i');
      const singleMatch = singlePattern.exec(text);
      if (singleMatch) {
        return [singleMatch[1]];
      }
    } catch (error) {
      console.error(`Error extracting ${attribute} attribute:`, error);
    }

    return undefined;
  }

  private static extractClassMapping(fullText: string, methodLine: number): string | undefined {
    try {
      const lines = fullText.split('\n');
      
      // Look backwards from method line to find class declaration (max 50 lines)
      for (let i = Math.max(0, methodLine - 50); i <= methodLine; i++) {
        const line = lines[i];
        
        // Found class declaration
        if (line.includes('class ')) {
          // Look backwards for class-level @RequestMapping (max 10 lines before class)
          for (let j = Math.max(0, i - 10); j <= i; j++) {
            const classLine = lines[j];
            const mappingMatch = classLine.match(/@RequestMapping\s*\(\s*"([^"]+)"\s*\)/);
            if (mappingMatch) {
              return mappingMatch[1];
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error('Error extracting class mapping:', error);
    }
    
    return undefined;
  }

  private static extractMethodInfo(text: string): { name: string, parameters: MethodParameter[] } | undefined {
    try {
      // Find method declaration with better error handling
      const methodPattern = /(public|private|protected)?\s*(static)?\s*[\w<>\[\],\s]+\s+(\w+)\s*\(([^)]*)\)/;
      const methodMatch = methodPattern.exec(text);
      
      if (!methodMatch) {
        return undefined;
      }

      const methodName = methodMatch[3];
      const paramString = methodMatch[4].trim();
      
      const parameters: MethodParameter[] = [];
      
      if (paramString) {
        const params = this.splitParameters(paramString);
        
        for (const param of params) {
          const paramInfo = this.parseParameter(param.trim());
          if (paramInfo) {
            parameters.push(paramInfo);
          }
        }
      }

      return { name: methodName, parameters };
    } catch (error) {
      console.error('Error extracting method info:', error);
      return undefined;
    }
  }

  private static splitParameters(paramString: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    
    try {
      for (let i = 0; i < paramString.length; i++) {
        const char = paramString[i];
        
        if (char === '"' && (i === 0 || paramString[i-1] !== '\\')) {
          inString = !inString;
        }
        
        if (!inString) {
          if (char === '<' || char === '(') {
            depth++;
          } else if (char === '>' || char === ')') {
            depth--;
          } else if (char === ',' && depth === 0) {
            if (current.trim()) {
              params.push(current.trim());
            }
            current = '';
            continue;
          }
        }
        
        current += char;
      }
      
      if (current.trim()) {
        params.push(current.trim());
      }
    } catch (error) {
      console.error('Error splitting parameters:', error);
      return [paramString]; // Fallback to single parameter
    }
    
    return params;
  }

  private static parseParameter(param: string): MethodParameter | undefined {
    try {
      // Parse parameter with annotation
      const annotationMatch = param.match(/(@\w+)(?:\([^)]*\))?\s+(.+)/);
      
      if (annotationMatch) {
        const annotation = annotationMatch[1];
        const remaining = annotationMatch[2];
        const typeNameMatch = remaining.match(/([\w<>\[\],\s]+)\s+(\w+)$/);
        
        if (typeNameMatch) {
          return {
            annotation: annotation,
            type: typeNameMatch[1].trim(),
            name: typeNameMatch[2].trim()
          };
        }
      } else {
        // Parse parameter without annotation
        const typeNameMatch = param.match(/([\w<>\[\],\s]+)\s+(\w+)$/);
        if (typeNameMatch) {
          return {
            type: typeNameMatch[1].trim(),
            name: typeNameMatch[2].trim()
          };
        }
      }
    } catch (error) {
      console.error('Error parsing parameter:', error);
    }
    
    return undefined;
  }

  private static async processMethodParameters(
    parameters: MethodParameter[],
    basePath: string,
    method: HttpMethod
  ): Promise<{ url: string, body?: string, headers: { [key: string]: string }, queryParams: string[] }> {

    let url = basePath;
    let body: string | undefined;
    const headers: { [key: string]: string } = {};
    const queryParams: string[] = [];

    try {
      for (const param of parameters) {
        if (param.annotation === '@RequestBody') {
          body = await this.handleRequestBody(body, param);
        } else if (param.annotation === '@PathVariable') {
          url = this.handlePathVariable(url, param);
        } else if (param.annotation === '@RequestParam') {
          this.handleRequestParam(queryParams, param);
        } else if (param.annotation === '@RequestHeader') {
          this.handleRequestHeader(headers, param);
        } else {
          this.handleDefaultParam(queryParams, param, method);
        }
      }

      if (queryParams.length > 0) {
        const separator = url.includes('?') ? '&' : '?';
        const queryString = queryParams.join('&');
        url += separator + queryString;
      }

    } catch (error) {
      console.error('Error processing method parameters:', error);
    }

    return { url, body, headers, queryParams };
  }

  private static async handleRequestBody(body: string | undefined, param: MethodParameter): Promise<string | undefined> {
    if (!body) {
      return await BodyGenerator.generate(param.type);
    }
    return body;
  }

  private static handlePathVariable(url: string, param: MethodParameter): string {
    const pathVarName = this.extractAnnotationValue(param.annotation!) || param.name;
    const pathVarValue = this.generateSamplePathValue(param.type);
    return url.replace(`{${pathVarName}}`, pathVarValue);
  }

  private static handleRequestParam(queryParams: string[], param: MethodParameter): void {
    const paramName = this.extractAnnotationValue(param.annotation!) || param.name;
    const paramValue = this.generateSampleQueryValue(param.type);
    queryParams.push(`${paramName}=${paramValue}`);
  }

  private static handleRequestHeader(headers: { [key: string]: string }, param: MethodParameter): void {
    const headerName = this.extractAnnotationValue(param.annotation!) || param.name;
    const headerValue = this.generateSampleHeaderValue(param.type, headerName);
    headers[headerName] = headerValue;
  }

  private static handleDefaultParam(queryParams: string[], param: MethodParameter, method: HttpMethod): void {
    if (!param.annotation && method === 'GET' && queryParams.length < 10) {
      const defaultParamValue = this.generateSampleQueryValue(param.type);
      queryParams.push(`${param.name}=${defaultParamValue}`);
    }
  }

  private static extractAnnotationValue(annotation: string): string | undefined {
    try {
      const valueMatch = annotation.match(/@\w+\s*\(\s*"([^"]+)"\s*\)/);
      if (valueMatch) {
        return valueMatch[1];
      }
      
      const namedValueMatch = annotation.match(/@\w+\s*\([^)]*value\s*=\s*"([^"]+)"[^)]*\)/);
      if (namedValueMatch) {
        return namedValueMatch[1];
      }
    } catch (error) {
      console.error('Error extracting annotation value:', error);
    }
    
    return undefined;
  }

  private static generateSamplePathValue(type: string): string {
    switch (type.toLowerCase()) {
      case 'string': return 'sample-id';
      case 'long':
      case 'integer':
      case 'int': return '123';
      case 'uuid': return '550e8400-e29b-41d4-a716-446655440000';
      default: return 'sample-value';
    }
  }

  private static generateSampleQueryValue(type: string): string {
    switch (type.toLowerCase()) {
      case 'string': return 'sample';
      case 'boolean': return 'true';
      case 'integer':
      case 'int':
      case 'long': return '10';
      case 'double':
      case 'float': return '10.5';
      default: return 'value';
    }
  }

  private static generateSampleHeaderValue(type: string, headerName: string): string {
    const lowerHeaderName = headerName.toLowerCase();
    
    if (lowerHeaderName.includes('authorization') || lowerHeaderName.includes('auth')) {
      return 'Bearer your-token-here';
    }
    if (lowerHeaderName.includes('content-type')) {
      return 'application/json';
    }
    if (lowerHeaderName.includes('accept')) {
      return 'application/json';
    }
    
    return 'header-value';
  }

  private static combinePaths(basePath: string, path: string): string {
    if (!basePath) return path;
    if (!path) return basePath;
    
    const cleanBase = basePath.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    
    return `${cleanBase}/${cleanPath}`;
  }

  private static async detectServerConfig(): Promise<{ port: number, contextPath: string }> {
    let port = 8080; // Default port
    let contextPath = ''; // Default context path

    try {
      const configFiles = ['application.properties', 'application.yml', 'application.yaml'];

      for (const configFile of configFiles) {
        const files = await vscode.workspace.findFiles(`**/${configFile}`, '**/node_modules/**', 1);
        
        if (files.length > 0) {
          const content = require('fs').readFileSync(files[0].fsPath, 'utf8');
          
          if (configFile.endsWith('.properties')) {
            const portMatch = content.match(/server\.port\s*[:=]\s*(\d+)/);
            if (portMatch) {
              port = parseInt(portMatch[1], 10);
            }
            const contextPathMatch = content.match(/server\.servlet\.context-path\s*=\s*([^\s]+)/);
            if (contextPathMatch) {
              contextPath = contextPathMatch[1];
            }
          } else { // YAML files
            const portMatch = content.match(/server:\s*\n\s*port:\s*(\d+)/);
            if (portMatch) {
              port = parseInt(portMatch[1], 10);
            }
            const contextPathMatch = content.match(/server:\s*\n\s*servlet:\s*\n\s*context-path:\s*([^\s]+)/);
            if (contextPathMatch) {
              contextPath = contextPathMatch[1];
            }
          }
        }
      }
    } catch (error) {
      console.warn('Could not detect server config from files:', error);
    }

    return { port, contextPath };
  }

  private static findMethodAfterAnnotation(
    document: vscode.TextDocument, 
    startPos: vscode.Position
  ): vscode.Range | null {
    try {
      const text = document.getText();
      const startOffset = document.offsetAt(startPos);
      const remainingText = text.substring(startOffset);
      
      // Look for method declaration within reasonable distance (max 5 lines)
      const methodPattern = /^\s*(public|private|protected)?\s*(static)?\s*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/m;
      const methodMatch = methodPattern.exec(remainingText);
      
      if (methodMatch && methodMatch.index < 500) { // Reasonable distance check
        const methodStart = startOffset + methodMatch.index;
        const methodEnd = methodStart + methodMatch[0].length;
        
        return new vscode.Range(
          document.positionAt(methodStart),
          document.positionAt(methodEnd)
        );
      }
    } catch (error) {
      console.error('Error finding method after annotation:', error);
    }
    
    return null;
  }

  public static async send(request: IRequest): Promise<void> {
    try {
      const config: AxiosRequestConfig = {
        method: request.method.toLowerCase() as any,
        url: request.url,
        headers: request.headers || {},
        timeout: 30000,
        validateStatus: () => true // Accept all status codes
      };

      if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
        config.data = request.body;
      }

      const response = await axios(config);
      
      // Show response in notification
      const responsePreview = response.data ? 
        JSON.stringify(response.data).substring(0, 100) : 
        response.statusText;
      
      const message = `${response.status >= 200 && response.status < 300 ? '✅' : '⚠️'} ${response.status} ${response.statusText} | ${responsePreview}${JSON.stringify(response.data || '').length > 100 ? '...' : ''}`;
      
      if (response.status >= 200 && response.status < 300) {
        vscode.window.showInformationMessage(message);
      } else {
        vscode.window.showWarningMessage(message);
      }
      
      // Show full response in new document if requested
      const config2 = vscode.workspace.getConfiguration('springboot-http-client');
      if (config2.get('showResponseInNewTab', true) && response.data) {
        const responseDoc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(response.data, null, 2),
          language: 'json'
        });
        await vscode.window.showTextDocument(responseDoc, vscode.ViewColumn.Beside);
      }
      
    } catch (error: any) {
      let errorMessage = '❌ Request failed';
      
      if (error.response) {
        errorMessage = `❌ ${error.response.status} ${error.response.statusText}`;
        if (error.response.data) {
          const errorData = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data);
          errorMessage += ` | ${errorData.substring(0, 100)}`;
        }
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = '❌ Connection refused - Is the server running?';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = '❌ Host not found - Check the URL';
      } else {
        errorMessage = `❌ ${error.message}`;
      }
      
      vscode.window.showErrorMessage(errorMessage);
    }
  }

  public static async generateFile(request: IRequest): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('springboot-http-client');
      const useEnvironmentVariables = config.get('useEnvironmentVariables', true);
      
      let content = '';
      
      if (useEnvironmentVariables) {
        const { port, contextPath } = await this.detectServerConfig();
        content += '### Environment Variables\n';
        content += `@host = http://localhost:${port}${contextPath}\n`;
        content += '@contentType = application/json\n';
        content += '@accept = application/json\n';
        content += '\n### Request\n';
      }
      
      const url = useEnvironmentVariables ? 
        request.url.replace(/https?:\/\/[^\/]+(\/[^\/]+)?/, '{{host}}') :
        request.url;
      
      content += `${request.method} ${url}\n`;
      
      if (request.headers) {
        for (const [key, value] of Object.entries(request.headers)) {
          let headerValue = value;
          if (useEnvironmentVariables && key.toLowerCase() === 'content-type') {
            headerValue = '{{contentType}}';
          } else if (useEnvironmentVariables && key.toLowerCase() === 'accept') {
            headerValue = '{{accept}}';
          }
          content += `${key}: ${headerValue}\n`;
        }
      }
      
      if (request.body) {
        content += '\n' + request.body;
      }
      
      content += '\n\n###\n';
      
      const document = await vscode.workspace.openTextDocument({ 
        content, 
        language: 'http' 
      });
      
      await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
      vscode.window.showInformationMessage('📄 HTTP file generated successfully!');
      
    } catch (error) {
      console.error('Error generating HTTP file:', error);
      vscode.window.showErrorMessage(`Failed to generate HTTP file: ${error}`);
    }
  }

  public static async copyAsCurl(request: IRequest): Promise<void> {
    try {
      let curlCommand = `curl -X ${request.method}`;
      
      if (request.headers) {
        for (const [key, value] of Object.entries(request.headers)) {
          curlCommand += ` -H "${key}: ${value}"`;
        }
      }
      
      if (request.body) {
        // Escape single quotes in the body
        const escapedBody = request.body.replace(/'/g, "'\"'\"'");
        curlCommand += ` -d '${escapedBody}'`;
      }
      
      curlCommand += ` "${request.url}"`;
      
      await vscode.env.clipboard.writeText(curlCommand);
      vscode.window.showInformationMessage('📋 cURL command copied to clipboard!');
      
    } catch (error) {
      console.error('Error copying cURL command:', error);
      vscode.window.showErrorMessage(`Failed to copy cURL command: ${error}`);
    }
  }

  public static async generateAllRequestsInDocument(document: vscode.TextDocument): Promise<void> {
    try {
      const text = document.getText();
      const requests = await this.collectRequestsFromDocument(document, text);

      if (requests.length > 0) {
        await this.showAllRequestsInHttpFile(requests);
      } else {
        vscode.window.showInformationMessage('No Spring Boot endpoints found in the current file.');
      }
    } catch (error) {
      console.error('Error generating all HTTP requests:', error);
      vscode.window.showErrorMessage(`Failed to generate all HTTP requests: ${error}`);
    }
  }

  private static async collectRequestsFromDocument(document: vscode.TextDocument, text: string): Promise<IRequest[]> {
    const mappingPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*(?:\([^)]*\))?/gm;
    let match;
    const requests: IRequest[] = [];

    while ((match = mappingPattern.exec(text)) !== null) {
      const request = await this.tryGenerateRequestFromMatch(document, match);
      if (request) {
        requests.push(request);
      }
    }
    return requests;
  }

  private static async tryGenerateRequestFromMatch(document: vscode.TextDocument, match: RegExpExecArray): Promise<IRequest | undefined> {
    const annotationEndPos = document.positionAt(match.index + match[0].length);
    const methodRange = this.findMethodAfterAnnotation(document, annotationEndPos);

    if (!methodRange) return undefined;

    const range = new vscode.Range(
      document.positionAt(match.index),
      methodRange.end
    );
    return await this.generate(document, range);
  }

  private static async showAllRequestsInHttpFile(requests: IRequest[]): Promise<void> {
    const { port, contextPath } = await this.detectServerConfig();
    let httpFileContent = `### Environment Variables\n@host = http://localhost:${port}${contextPath}\n@contentType = application/json\n@accept = application/json\n\n###\n\n`;

    for (const request of requests) {
      httpFileContent += this.formatRequestForHttpFile(request);
    }

    const httpDocument = await vscode.workspace.openTextDocument({
      content: httpFileContent,
      language: 'http'
    });
    await vscode.window.showTextDocument(httpDocument, vscode.ViewColumn.Beside);
  }

  private static formatRequestForHttpFile(request: IRequest): string {
    const url = request.url.replace(/https?:\/\/[^\/]+(\/[^\/]+)?/, '{{host}}');
    let content = `${request.method} ${url}\n`;
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        content += `${key}: ${value}\n`;
      }
    }
    if (request.body) {
      content += `\n${request.body}\n`;
    }
    content += '\n###\n\n';
    return content;
  }
}
