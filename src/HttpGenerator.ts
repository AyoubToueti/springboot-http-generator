import * as vscode from 'vscode';
import { IRequest } from './types';
import { AppDetector } from './AppDetector';
import { ActuatorClient } from './ActuatorClient';
import { BodyGenerator } from './BodyGenerator';
import axios from 'axios';

export class HttpGenerator {
  public static async generate(document: vscode.TextDocument, range: vscode.Range): Promise<IRequest | undefined> {
    const text = document.getText(range);
    const methodMatch = text.match(/@(Get|Post|Put|Delete|Patch)Mapping(\(.*\))?/);
    if (!methodMatch) {
      return;
    }

    const methodName = document.getText(document.lineAt(range.start.line + 1).range).match(/(\w+)\(.*\)/)?.[1];
    if (!methodName) {
      return;
    }

    const mappings = await ActuatorClient.getMappings();
    const mapping = mappings.find(m => m.handler.includes(methodName));

    let method: IRequest['method'];
    let path: string;
    let url: string;

    if (mapping) {
      method = mapping.details.requestMappingConditions.methods[0].toUpperCase() as IRequest['method'];
      path = mapping.details.requestMappingConditions.patterns[0];
      const port = await AppDetector.getPort();
      url = `http://localhost:${port}${path}`;
    } else {
      const methodMatch = text.match(/@(Get|Post|Put|Delete|Patch)Mapping(\(.*\))?/);
      if (!methodMatch) {
        return;
      }
      method = methodMatch[1].toUpperCase() as IRequest['method'];
      const pathMatch = text.match(/@(?:Get|Post|Put|Delete|Patch)Mapping\("([^"]*)"\)/);
      path = pathMatch ? pathMatch[1] : '';
      url = `{{host}}${path}`;
    }

    const methodSignature = document.getText(document.lineAt(range.start.line + 1).range);
    const paramsMatch = methodSignature.match(/\((.*)\)/);
    let body: string | undefined;
    const queryParams: string[] = [];

    if (paramsMatch) {
      const params = paramsMatch[1].split(',').map(p => p.trim());
      for (const param of params) {
        if (param.startsWith('@RequestBody')) {
          const requestBodyMatch = param.match(/@RequestBody\s+(\w+)/);
          if (requestBodyMatch) {
            body = await BodyGenerator.generate(requestBodyMatch[1]);
          }
        } else if (!param.startsWith('@')) {
          const paramMatch = param.match(/(\w+)\s+(\w+)/);
          if (paramMatch) {
            const className = paramMatch[1];
            const fields = await BodyGenerator.generate(className);
            if (fields) {
              try {
                const parsedFields = JSON.parse(fields);
                for (const key in parsedFields) {
                  queryParams.push(`${key}=`);
                }
              } catch (e) {
                // Silently fail for now, or add logging
              }
            }
          }
        }
      }
    }

    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }

    return { method, url, body };
  }

  public static async send(request: IRequest): Promise<void> {
    try {
      const response = await axios({
        method: request.method,
        url: request.url,
        data: request.body,
        headers: request.headers,
      });
      vscode.window.showInformationMessage(`✅ ${response.status} ${response.statusText} | Response: ${JSON.stringify(response.data)}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`❌ ${error.message}`);
    }
  }

  public static async generateFile(request: IRequest): Promise<void> {
    let content = '';
    if (request.url.startsWith('{{host}}')) {
      content += '@host = change_me\n###\n';
    }
    content += `${request.method} ${request.url}\nAccept: application/json`;
    if (request.body) {
      content += `\nContent-Type: application/json\n\n${request.body}`;
    }
    const document = await vscode.workspace.openTextDocument({ content, language: 'http' });
    await vscode.window.showTextDocument(document);
  }
}
