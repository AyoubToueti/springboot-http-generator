import * as vscode from 'vscode';
import { CodelensProvider } from './codelensProvider';
import { HttpGenerator } from './HttpGenerator';

export function activate(context: vscode.ExtensionContext) {
  const codelensProvider = new CodelensProvider();

  vscode.languages.registerCodeLensProvider('java', codelensProvider);

  vscode.commands.registerCommand('springboot.enableCodeLens', () => {
    vscode.workspace.getConfiguration('codelens-sample').update('enableCodeLens', true, true);
  });

  vscode.commands.registerCommand('springboot.disableCodeLens', () => {
    vscode.workspace.getConfiguration('codelens-sample').update('enableCodeLens', false, true);
  });

  vscode.commands.registerCommand('springboot.sendRequest', async (document: vscode.TextDocument, range: vscode.Range) => {
    const request = await HttpGenerator.generate(document, range);
    if (request) {
      await HttpGenerator.send(request);
    }
  });

  vscode.commands.registerCommand('springboot.generateHttpRequest', async (document: vscode.TextDocument, range: vscode.Range) => {
    const request = await HttpGenerator.generate(document, range);
    if (request) {
      await HttpGenerator.generateFile(request);
    }
  });
}

export function deactivate() {}
