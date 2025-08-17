"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = __importStar(require("vscode"));
// import * as myExtension from '../../extension';
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    test('should activate the extension', async () => {
        const extension = vscode.extensions.getExtension('springboot-http-generator');
        assert.ok(extension);
        await extension.activate();
        assert.ok(extension.isActive);
    });
    test('should generate request body', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'java',
            content: `
				public class User {
					private String name;
					private Integer age;
				}

				@RestController
				public class UserController {
					@PostMapping("/users")
					public void createUser(@RequestBody User user) {
					}
				}
			`
        });
        const position = new vscode.Position(8, 5);
        const range = document.getWordRangeAtPosition(position, /@PostMapping\("([^"]*)"\)/);
        assert.ok(range);
        const request = await vscode.commands.executeCommand('springboot.generateHttpRequest', document, range);
        assert.ok(request);
    });
});
//# sourceMappingURL=extension.test.js.map