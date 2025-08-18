import * as vscode from 'vscode';
import * as fs from 'fs/promises';

export class AppDetector {
  private static isDetecting = false;
  private static detectionResult: boolean | undefined = undefined;

  public static async isSpringBootProject(): Promise<boolean> {
    if (this.isDetecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.isSpringBootProject();
    }

    if (this.detectionResult !== undefined) {
      return this.detectionResult;
    }

    this.isDetecting = true;
    try {
      this.detectionResult = await this.detectSpringBoot();
      return this.detectionResult;
    } catch (error) {
      console.error('Error detecting Spring Boot project:', error);
      this.detectionResult = false;
      return false;
    } finally {
      this.isDetecting = false;
    }
  }

  private static async detectSpringBoot(): Promise<boolean> {
    const springBootIndicators = [
      'pom.xml', 'build.gradle', 'settings.gradle',
      'application.properties', 'application.yml', 'application.yaml',
      'mvnw', 'gradlew'
    ];

    for (const indicator of springBootIndicators) {
      const files = await vscode.workspace.findFiles(`**/${indicator}`, '**/node_modules/**', 1);
      if (files.length > 0) {
        if (indicator.includes('pom.xml') || indicator.includes('gradle')) {
          try {
            const content = await fs.readFile(files[0].fsPath, 'utf8');
            if (content.includes('spring-boot')) {
              return true;
            }
          } catch (error) {
            console.error(`Error reading ${indicator}:`, error);
          }
        } else {
          return true;
        }
      }
    }
    return false;
  }

  public static async getPort(): Promise<number> {
    try {
      const files = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}', '**/node_modules/**', 1);
      if (files.length > 0) {
        const fileContent = await fs.readFile(files[0].fsPath, 'utf8');
        
        let match = /server\.port\s*=\s*(\d+)/.exec(fileContent);
        if (match) {
          return parseInt(match[1], 10);
        }
        
        match = /server:\s*\n\s*port:\s*(\d+)/.exec(fileContent);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    } catch (error) {
      console.error('Error reading port from config:', error);
    }
    
    return 8080;
  }

  public static isRunning(port: number): boolean {
    try {
      const terminal = vscode.window.createTerminal({ name: 'Spring Boot Check', hideFromUser: true });
      terminal.sendText(`lsof -i:${port}`);
      terminal.dispose();
      return true;
    } catch (error) {
      console.warn('Could not determine if Spring Boot is running:', error);
      return false;
    }
  }
}
