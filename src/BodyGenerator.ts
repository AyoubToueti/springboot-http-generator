import * as vscode from 'vscode';
import { promises as fs } from 'fs';

interface JavaField {
  name: string;
  type: string;
  isCollection: boolean;
  genericType?: string;
}

export class BodyGenerator {
  private static readonly cache: Map<string, string> = new Map();
  private static readonly MAX_CACHE_SIZE = 100;
  private static readonly MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
  private static readonly GENERATION_TIMEOUT = 5000; // 5 second timeout

  private static readonly typeMapping: { [key: string]: any } = {
    'String': 'example',
    'Integer': 42,
    'int': 42,
    'Long': 123456789,
    'long': 123456789,
    'Double': 3.14159,
    'double': 3.14159,
    'Float': 2.71828,
    'float': 2.71828,
    'BigDecimal': 99.99,
    'Boolean': true,
    'boolean': true,
    'Date': '2024-01-15T10:30:00Z',
    'LocalDate': '2024-01-15',
    'LocalDateTime': '2024-01-15T10:30:00',
    'UUID': '550e8400-e29b-41d4-a716-446655440000',
    'Instant': '2024-01-15T10:30:00Z'
  };

  public static async generate(className: string): Promise<string | undefined> {
    try {
      // Check cache first
      const cacheKey = `body:${className}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Add timeout to prevent hanging
      const result = await Promise.race([
        this.generateInternal(className),
        new Promise<string | undefined>((_, reject) => 
          setTimeout(() => reject(new Error('Generation timeout')), this.GENERATION_TIMEOUT)
        )
      ]);

      // Cache the result
      if (result) {
        this.addToCache(cacheKey, result);
      }

      return result;
    } catch (error) {
      console.error(`Error generating body for ${className}:`, error);
      return undefined;
    }
  }

  private static async generateInternal(className: string): Promise<string | undefined> {
    // First try exact match
    let files = await vscode.workspace.findFiles(`**/${className}.java`, '**/node_modules/**', 10);
    
    if (files.length === 0) {
      // Try partial match with more restrictive pattern
      const searchPattern = `**/*${className}*.java`;
      files = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 5);
    }

    if (files.length === 0) {
      console.log(`Class ${className} not found in workspace`);
      return undefined;
    }

    // Take the first matching file
    const file = files[0];
    
    try {
      // Check file size before reading
      const stat = await fs.stat(file.fsPath);
      if (stat.size > this.MAX_FILE_SIZE) {
        console.log(`File ${file.fsPath} too large (${stat.size} bytes), skipping`);
        return undefined;
      }

      const fileContent = await fs.readFile(file.fsPath, 'utf8');
      const fields = this.extractFields(fileContent, className);
      
      if (fields.length === 0) {
        return '{}'; // Empty object for classes with no fields
      }

      const body = await this.generateSampleBody(fields, new Set([className]));
      return JSON.stringify(body, null, 2);
      
    } catch (error) {
      console.error(`Error reading file ${file.fsPath}:`, error);
      return undefined;
    }
  }

  private static addToCache(key: string, value: string): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entries
      const keysToDelete = Array.from(this.cache.keys()).slice(0, 10);
      keysToDelete.forEach(k => this.cache.delete(k));
    }
    this.cache.set(key, value);
  }

  private static extractFields(content: string, className: string): JavaField[] {
    const fields: JavaField[] = [];
    
    try {
      // Clean content and find class
      const cleanContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\/\/.*$/gm, ''); // Remove line comments

      // More precise class finding
      const classRegex = new RegExp(`(?:public\\s+)?class\\s+${className}\\s*(?:extends\\s+\\w+)?(?:\\s+implements\\s+[\\w,\\s]+)?\\s*\\{`, 'g');
      const classMatch = classRegex.exec(cleanContent);
      
      if (!classMatch) {
        console.log(`Class ${className} not found in content`);
        return fields;
      }

      const classStart = classMatch.index + classMatch[0].length;
      const classBody = this.extractClassBody(cleanContent, classStart);

      if (!classBody) {
        return fields;
      }

      // Extract field declarations with improved patterns
      const fieldPatterns = [
        // Private fields: private Type name;
        /^\s*private\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/gm,
        // Public fields: public Type name;
        /^\s*public\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/gm,
        // Protected fields: protected Type name;
        /^\s*protected\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/gm
      ];

      const foundFields = new Set<string>();

      for (const pattern of fieldPatterns) {
        let match;
        pattern.lastIndex = 0; // Reset regex
        
        while ((match = pattern.exec(classBody)) !== null) {
          const fullType = match[1].trim();
          const fieldName = match[2].trim();

          // Skip if already found or invalid
          if (foundFields.has(fieldName) || 
              fieldName.toUpperCase() === fieldName || // Skip constants
              fieldName.includes('(') ||               // Skip methods
              fieldName.length < 2) {                  // Skip very short names
            continue;
          }

          const field = this.parseFieldType(fullType, fieldName);
          if (field) {
            fields.push(field);
            foundFields.add(fieldName);
          }

          // Limit number of fields to prevent excessive generation
          if (fields.length >= 20) {
            break;
          }
        }
      }

    } catch (error) {
      console.error(`Error extracting fields from ${className}:`, error);
    }

    return fields;
  }

  private static parseFieldType(fullType: string, fieldName: string): JavaField | null {
    try {
      const isCollection = /^(List|Set|Collection|ArrayList|HashSet|Vector)</.test(fullType);
      let type = fullType;
      let genericType: string | undefined;

      if (isCollection) {
        const genericMatch = /<([^<>]+)>/.exec(fullType);
        if (genericMatch) {
          genericType = genericMatch[1].trim();
          type = fullType.split('<')[0];
        }
      }

      return {
        name: fieldName,
        type: type,
        isCollection: isCollection,
        genericType: genericType
      };
    } catch (error) {
      console.error(`Error parsing field type ${fullType}:`, error);
      return null;
    }
  }

  private static extractClassBody(content: string, startIndex: number): string | null {
    try {
      let braceCount = 1;
      let index = startIndex;
      
      while (index < content.length && braceCount > 0) {
        const char = content[index];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
        }
        index++;
        
        // Safety check to prevent infinite loops
        if (index - startIndex > 100000) {
          console.log('Class body extraction taking too long, aborting');
          return null;
        }
      }
      
      return content.substring(startIndex, index - 1);
    } catch (error) {
      console.error('Error extracting class body:', error);
      return null;
    }
  }

  private static async generateSampleBody(fields: JavaField[], visited: Set<string>): Promise<any> {
    const body: any = {};
    
    for (const field of fields) {
      if (visited.has(field.name) || visited.size > 10) {
        continue; // Prevent excessive nesting
      }

      try {
        if (field.isCollection) {
          body[field.name] = await this.generateCollectionValue(field, visited);
        } else {
          body[field.name] = await this.generateFieldValue(field, visited);
        }
      } catch (error) {
        console.error(`Error generating value for field ${field.name}:`, error);
        body[field.name] = null;
      }
    }
    
    return body;
  }

  private static async generateCollectionValue(field: JavaField, visited: Set<string>): Promise<any[]> {
    if (field.genericType && !visited.has(field.genericType)) {
      const sampleValue = await this.generateValueByType(field.genericType, visited);
      if (sampleValue !== undefined) {
        return [sampleValue];
      }
    }
    return [];
  }

  private static async generateFieldValue(field: JavaField, visited: Set<string>): Promise<any> {
    return await this.generateValueByType(field.type, visited);
  }

  private static async generateValueByType(type: string, visited: Set<string>): Promise<any> {
    // Handle primitive and common types first
    if (this.typeMapping.hasOwnProperty(type)) {
      return this.typeMapping[type];
    }

    // Handle custom objects (only if not already visited and reasonable depth)
    if (type.charAt(0).toUpperCase() === type.charAt(0) && 
        !visited.has(type) && 
        visited.size < 5) { // Limit recursion depth
      
      const newVisited = new Set(visited);
      newVisited.add(type);
      
      try {
        const nestedBody = await this.generate(type);
        if (nestedBody) {
          return JSON.parse(nestedBody);
        }
      } catch (error) {
        console.error(`Error generating nested object for type ${type}:`, error);
      }
    }
    
    return null;
  }

  public static clearCache(): void {
    this.cache.clear();
  }
}
