import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
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
