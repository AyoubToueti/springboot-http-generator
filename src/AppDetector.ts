import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class AppDetector {
  private static isDetecting = false;
  private static detectionResult: boolean | undefined = undefined;

  public static async isSpringBootProject(): Promise<boolean> {
    if (this.isDetecting) {
      // Wait for the ongoing detection to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.isSpringBootProject();
    }

    if (this.detectionResult !== undefined) {
      return this.detectionResult;
    }

    this.isDetecting = true;
    try {
      const springBootIndicators = [
        'pom.xml',
        'build.gradle',
        'settings.gradle',
        'application.properties',
        'application.yml',
        'application.yaml',
        'mvnw',
        'gradlew'
      ];

      // Limit search to 1 file per indicator for performance
      for (const indicator of springBootIndicators) {
        const files = await vscode.workspace.findFiles(`**/${indicator}`, '**/node_modules/**', 1);
        if (files.length > 0) {
          // More specific checks for build files
          if (indicator.includes('pom.xml') || indicator.includes('gradle')) {
            try {
              const content = await fs.readFile(files[0].fsPath, 'utf8');
              if (content.includes('spring-boot')) {
                this.detectionResult = true;
                return true;
              }
            } catch (error) {
              console.error(`Error reading ${indicator}:`, error);
            }
          } else {
            this.detectionResult = true;
            return true;
          }
        }
      }

      this.detectionResult = false;
      return false;
    } catch (error) {
      console.error('Error detecting Spring Boot project:', error);
      this.detectionResult = false;
      return false;
    } finally {
      this.isDetecting = false;
    }
  }

  public static async getPort(): Promise<number> {
    try {
      const files = await vscode.workspace.findFiles('**/application.{properties,yml,yaml}', '**/node_modules/**', 1);
      if (files.length > 0) {
        const fileContent = await fs.readFile(files[0].fsPath, 'utf8');
        
        // Check for properties file format
        let match = fileContent.match(/server\.port\s*=\s*(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
        
        // Check for YAML file format
        match = fileContent.match(/server:\s*\n\s*port:\s*(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    } catch (error) {
      console.error('Error reading port from config:', error);
    }
    
    return 8080; // Default port
  }

  public static async isRunning(port: number): Promise<boolean> {
    try {
      // This is a simplistic check and may not be reliable across all platforms
      // A proper implementation would involve checking if the port is in use
      // For now, we'll assume it's running if the check doesn't throw an error
      const terminal = vscode.window.createTerminal({ name: 'Spring Boot Check', hideFromUser: true });
      await terminal.sendText(`lsof -i:${port}`); // 'lsof' is not available on Windows
      terminal.dispose();
      return true;
    } catch (error) {
      console.warn('Could not determine if Spring Boot is running:', error);
      return false;
    }
  }
}
