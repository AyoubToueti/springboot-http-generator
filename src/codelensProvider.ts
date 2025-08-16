import * as vscode from 'vscode';

export class CodelensProvider implements vscode.CodeLensProvider {
  private regex: RegExp;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    this.regex = /@(Get|Post|Put|Delete|Patch)Mapping(\(.*\))?/g;
    vscode.workspace.onDidChangeTextDocument((_) => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    if (vscode.workspace.getConfiguration("codelens-sample").get("enableCodeLens", true)) {
      const codeLenses: vscode.CodeLens[] = [];
      const regex = new RegExp(this.regex);
      const text = document.getText();
      let matches;
      while ((matches = regex.exec(text)) !== null) {
        const line = document.lineAt(document.positionAt(matches.index).line);
        const indexOf = line.text.indexOf(matches[0]);
        const position = new vscode.Position(line.lineNumber, indexOf);
        const range = document.getWordRangeAtPosition(position, new RegExp(this.regex));
        if (range) {
          codeLenses.push(new vscode.CodeLens(range, {
            title: "▶ Send Request",
            command: "springboot.sendRequest",
            arguments: [document, range]
          }));
          codeLenses.push(new vscode.CodeLens(range, {
            title: "📄 Generate .http",
            command: "springboot.generateHttpRequest",
            arguments: [document, range]
          }));
        }
      }
      return codeLenses;
    }
    return [];
  }
}
