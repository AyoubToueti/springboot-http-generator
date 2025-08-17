import * as vscode from 'vscode';
import { CodelensProvider } from './codelensProvider';
import { HttpGenerator } from './HttpGenerator';
import { AppDetector } from './AppDetector';

let codelensProvider: CodelensProvider | undefined;
let codeLensDisposable: vscode.Disposable | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Spring Boot HTTP Client extension activating...');

  try {
    // Only activate if we detect Spring Boot in the workspace
    if (!await AppDetector.isSpringBootProject()) {
      console.log('No Spring Boot project detected, extension will remain dormant');
      // Still register commands but don't activate CodeLens
      registerCommands(context);
      return;
    }

    console.log('Spring Boot project detected, activating CodeLens...');
    
    // Create and register CodeLens provider
    codelensProvider = new CodelensProvider();
    codeLensDisposable = vscode.languages.registerCodeLensProvider(
      { language: 'java', scheme: 'file' }, // More specific selector
      codelensProvider
    );

    // Register all commands
    registerCommands(context);
    registerConfigurationHandlers(context);

    // Add disposables to context
    if (codeLensDisposable) {
      context.subscriptions.push(codeLensDisposable);
    }

    // Show subtle activation message
    console.log('Spring Boot HTTP Client extension activated successfully');
    
  } catch (error) {
    console.error('Error activating Spring Boot HTTP Client:', error);
    vscode.window.showErrorMessage(`Failed to activate Spring Boot HTTP Client: ${error}`);
  }
}

function registerCommands(context: vscode.ExtensionContext) {
  // Command: Send HTTP Request
  const sendRequestCommand = vscode.commands.registerCommand(
    'springboot.sendRequest',
    async (document: vscode.TextDocument, range: vscode.Range) => {
      await executeWithErrorHandling('send request', async () => {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Sending HTTP request...",
          cancellable: true
        }, async (progress, token) => {
          const request = await HttpGenerator.generate(document, range);
          if (request && !token.isCancellationRequested) {
            await HttpGenerator.send(request);
          } else if (!request) {
            vscode.window.showWarningMessage('Could not generate HTTP request from the selected code');
          }
        });
      });
    }
  );

  // Command: Generate HTTP File
  const generateHttpCommand = vscode.commands.registerCommand(
    'springboot.generateHttpRequest',
    async (document: vscode.TextDocument, range: vscode.Range) => {
      await executeWithErrorHandling('generate .http file', async () => {
        const request = await HttpGenerator.generate(document, range);
        if (request) {
          await HttpGenerator.generateFile(request);
        } else {
          vscode.window.showWarningMessage('Could not generate HTTP request from the selected code');
        }
      });
    }
  );

  // Command: Copy as cURL
  const copyAsCurlCommand = vscode.commands.registerCommand(
    'springboot.copyAsCurl',
    async (document: vscode.TextDocument, range: vscode.Range) => {
      await executeWithErrorHandling('copy as cURL', async () => {
        const request = await HttpGenerator.generate(document, range);
        if (request) {
          await HttpGenerator.copyAsCurl(request);
        } else {
          vscode.window.showWarningMessage('Could not generate HTTP request from the selected code');
        }
      });
    }
  );

  // Configuration commands
  const enableCodeLensCommand = vscode.commands.registerCommand(
    'springboot.enableCodeLens',
    () => {
      vscode.workspace.getConfiguration('springboot-http-client')
        .update('enableCodeLens', true, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage('CodeLens enabled for Spring Boot HTTP Client');
    }
  );

  const disableCodeLensCommand = vscode.commands.registerCommand(
    'springboot.disableCodeLens', 
    () => {
      vscode.workspace.getConfiguration('springboot-http-client')
        .update('enableCodeLens', false, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage('CodeLens disabled for Spring Boot HTTP Client');
    }
  );

  // Add all commands to context subscriptions
  context.subscriptions.push(
    sendRequestCommand,
    generateHttpCommand,
    copyAsCurlCommand,
    enableCodeLensCommand,
    disableCodeLensCommand
  );
}

function registerConfigurationHandlers(context: vscode.ExtensionContext) {
  // Handle configuration changes
  const configChangeHandler = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('springboot-http-client.enableCodeLens')) {
      // Refresh CodeLens when the setting changes
      if (codelensProvider) {
        codelensProvider['_onDidChangeCodeLenses'].fire();
      }
    }
  });

  context.subscriptions.push(configChangeHandler);
}

async function executeWithErrorHandling(operation: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`Error during ${operation}:`, error);
    vscode.window.showErrorMessage(
      `Failed to ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function deactivate() {
  console.log('Spring Boot HTTP Client extension deactivating...');
  
  try {
    // Clean up resources
    if (codelensProvider) {
      codelensProvider.dispose();
      codelensProvider = undefined;
    }

    if (codeLensDisposable) {
      codeLensDisposable.dispose();
      codeLensDisposable = undefined;
    }

    // Clear any caches
    const { BodyGenerator } = require('./BodyGenerator');
    BodyGenerator.clearCache();

    console.log('Spring Boot HTTP Client extension deactivated');
    
  } catch (error) {
    console.error('Error during deactivation:', error);
  }
}
