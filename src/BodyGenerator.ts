import * as vscode from 'vscode';
import * as fs from 'fs';

export class BodyGenerator {
  public static async generate(className: string): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(`**/${className}.java`);
    if (files.length === 0) {
      return;
    }

    const fileContent = fs.readFileSync(files[0].fsPath, 'utf8');
    let classDeclaration;
    try {
      const { parse } = await import('java-parser');
      const cst = parse(fileContent);
      classDeclaration = this.findClassDeclaration(cst);
      if (!classDeclaration) {
        return;
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`⚠️ Could not generate body for ${className}. Class not found or has syntax errors.`);
      return;
    }

    const fields = this.findFields(classDeclaration);
    const body = this.generateBody(fields);

    return JSON.stringify(body, null, 2);
  }

  private static findClassDeclaration(cst: any): any {
    if (cst.name === 'classDeclaration') {
      return cst;
    }

    if (cst.children) {
      for (const key in cst.children) {
        const child = cst.children[key][0];
        const classDeclaration = this.findClassDeclaration(child);
        if (classDeclaration) {
          return classDeclaration;
        }
      }
    }
  }

  private static findFields(classDeclaration: any): any[] {
    const fields: any[] = [];
    const fieldDeclarations = classDeclaration.children.classBody[0].children.classBodyDeclaration;
    if (fieldDeclarations) {
      for (const fieldDeclaration of fieldDeclarations) {
        const field = fieldDeclaration.children.fieldDeclaration[0];
        const type = field.children.unannType[0].children.unannClassOrInterfaceType[0].children.unannClassType[0].children.Identifier[0].image;
        const name = field.children.variableDeclaratorList[0].children.variableDeclarator[0].children.variableDeclaratorId[0].children.Identifier[0].image;
        fields.push({ type, name });
      }
    }
    return fields;
  }

  private static generateBody(fields: any[]): any {
    const body: any = {};
    for (const field of fields) {
      switch (field.type) {
        case 'String':
          body[field.name] = '';
          break;
        case 'Integer':
        case 'Long':
        case 'Double':
        case 'Float':
        case 'BigDecimal':
          body[field.name] = 0;
          break;
        case 'Boolean':
          body[field.name] = false;
          break;
        default:
          body[field.name] = {};
          break;
      }
    }
    return body;
  }
}
