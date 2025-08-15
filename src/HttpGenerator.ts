import * as vscode from 'vscode';
import { IRequest } from './types';
import { AppDetector } from './AppDetector';
import axios from 'axios';

export class HttpGenerator {
  public static async generate(document: vscode.TextDocument, range: vscode.Range): Promise<IRequest | undefined> {
    const text = document.getText(range);
    const methodMatch = text.match(/@(Get|Post|Put|Delete|Patch)Mapping\("([^"]*)"\)/);
    if (!methodMatch) {
      return;
    }

    const method = methodMatch[1].toUpperCase() as IRequest['method'];
    const path = methodMatch[2];
    const port = await AppDetector.getPort();
    const url = `http://localhost:${port}${path}`;

    return { method, url };
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
    const content = `${request.method} ${request.url}\nAccept: application/json`;
    const document = await vscode.workspace.openTextDocument({ content, language: 'http' });
    await vscode.window.showTextDocument(document);
  }
}
