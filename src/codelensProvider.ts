import * as vscode from 'vscode';

export class CodelensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
  private debounceTimer: NodeJS.Timeout | undefined;
  private cache: Map<string, vscode.CodeLens[]> = new Map();

  constructor() {
    // Only listen to Java file changes and debounce them
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'java' && this.isSpringBootController(e.document.getText())) {
        this.debounceRefresh();
      }
    });

    // Clear cache when files are closed
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === 'java') {
        this.cache.delete(doc.uri.toString());
      }
    });
  }

  private debounceRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onDidChangeCodeLenses.fire();
    }, 500); // 500ms debounce
  }

  private isSpringBootController(text: string): boolean {
    // Quick check for Spring Boot annotations to avoid processing non-controller files
    const springAnnotations = [
      '@RestController',
      '@Controller', 
      '@RequestMapping',
      '@GetMapping',
      '@PostMapping',
      '@PutMapping',
      '@DeleteMapping',
      '@PatchMapping'
    ];
    
    return springAnnotations.some(annotation => text.includes(annotation));
  }

  public provideCodeLenses(
    document: vscode.TextDocument, 
    token: vscode.CancellationToken
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    
    // Check if CodeLens is enabled
    const config = vscode.workspace.getConfiguration("springboot-http-client");
    if (!config.get("enableCodeLens", true)) {
      return [];
    }

    // Only process Java files
    if (document.languageId !== 'java') {
      return [];
    }

    // Check cache first
    const cacheKey = document.uri.toString() + document.version;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const text = document.getText();
    
    // Early exit if this doesn't look like a Spring Boot controller
    if (!this.isSpringBootController(text)) {
      return [];
    }

    // Check for cancellation
    if (token.isCancellationRequested) {
      return [];
    }

    try {
      const codeLenses = this.detectSpringMappings(document, token);
      
      // Cache the results
      this.cache.set(cacheKey, codeLenses);
      
      // Limit cache size
      if (this.cache.size > 50) {
        const firstKey = this.cache.keys().next().value;
        if (typeof firstKey === 'string') {
          this.cache.delete(firstKey);
        }
      }
      
      return codeLenses;
    } catch (error) {
      console.error('Error in SpringBoot CodeLens provider:', error);
      return [];
    }
  }

  private detectSpringMappings(
    document: vscode.TextDocument, 
    token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();
    
    // More specific patterns to avoid false positives
    const mappingPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\([^)]*\))?\s*(?:\/\/.*)?$/gm;
    
    let match;
    while ((match = mappingPattern.exec(text)) !== null) {
      // Check for cancellation during processing
      if (token.isCancellationRequested) {
        break;
      }

      const matchStart = match.index;
      const annotationEndPos = document.positionAt(matchStart + match[0].length);
      
      // Find the method declaration following the annotation
      const methodRange = this.findMethodAfterAnnotation(document, annotationEndPos);
      if (!methodRange) continue;

      // Verify this is actually a controller method by checking for method modifiers
      const methodText = document.getText(methodRange);
      if (!this.isControllerMethod(methodText)) continue;

      const range = new vscode.Range(
        document.positionAt(matchStart),
        methodRange.end
      );

      // Add code lenses with more specific titles
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: "🚀 Send Request",
          command: "springboot.sendRequest",
          arguments: [document, range]
        }),
        new vscode.CodeLens(range, {
          title: "📄 Generate .http",
          command: "springboot.generateHttpRequest",
          arguments: [document, range]
        }),
        new vscode.CodeLens(range, {
          title: "📋 Copy cURL",
          command: "springboot.copyAsCurl",
          arguments: [document, range]
        })
      );
    }

    return codeLenses;
  }

  private findMethodAfterAnnotation(
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

  private isControllerMethod(methodText: string): boolean {
    // Verify this looks like a controller method
    const controllerMethodPattern = /(public|private|protected)\s+.*\s+\w+\s*\([^)]*\)/;
    return controllerMethodPattern.test(methodText);
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.cache.clear();
    this._onDidChangeCodeLenses.dispose();
  }
}