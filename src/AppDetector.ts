import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class AppDetector {
  public static async getPort(): Promise<number> {
    const files = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}');
    if (files.length > 0) {
      const fileContent = fs.readFileSync(files[0].fsPath, 'utf8');
      const match = fileContent.match(/server\.port\s*=\s*(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 8080;
  }

  public static async isRunning(port: number): Promise<boolean> {
    try {
      const terminal = vscode.window.createTerminal('Spring Boot Check');
      terminal.sendText(`lsof -i:${port}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
