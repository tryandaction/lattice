const vscode = require("vscode");

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("lattice-fixture");

  const publishDiagnostics = (document) => {
    if (!document || document.languageId !== "typescript") return;
    diagnostics.set(document.uri, [
      new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 12)),
        `fixture-version-${document.version}`,
        vscode.DiagnosticSeverity.Warning,
      ),
    ]);
  };

  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("fixture.afterFix", () => true),
    vscode.languages.registerCompletionItemProvider("typescript", {
      provideCompletionItems() {
        const item = new vscode.CompletionItem("fixtureAnswer", vscode.CompletionItemKind.Variable);
        item.detail = "Lattice fixture completion";
        item.insertText = "fixtureAnswer";
        return [item];
      },
    }, "."),
    vscode.languages.registerHoverProvider("typescript", {
      provideHover() {
        return {
          contents: [new vscode.MarkdownString("Lattice fixture hover")],
          range: new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 12)),
        };
      },
    }),
    vscode.languages.registerDefinitionProvider("typescript", {
      provideDefinition(document) {
        return new vscode.Location(
          document.uri,
          new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 12)),
        );
      },
    }),
    vscode.languages.registerReferenceProvider("typescript", {
      provideReferences(document) {
        return [new vscode.Location(
          document.uri,
          new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 6)),
        )];
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider("typescript", {
      provideDocumentFormattingEdits() {
        return [{
          range: new vscode.Range(new vscode.Position(0, 12), new vscode.Position(0, 15)),
          newText: " = 42",
        }];
      },
    }),
    vscode.languages.registerRenameProvider("typescript", {
      provideRenameEdits(document, _position, newName) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 12)),
          newName,
        );
        edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 6)),
          newName,
        );
        return edit;
      },
    }),
    vscode.languages.registerCodeActionsProvider("typescript", {
      provideCodeActions(document) {
        const action = new vscode.CodeAction("Use result", vscode.CodeActionKind.QuickFix);
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(
          document.uri,
          new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 12)),
          "result",
        );
        action.command = {
          command: "fixture.afterFix",
          title: "After fix",
          arguments: ["result"],
        };
        return [action];
      },
    }),
    vscode.workspace.onDidChangeTextDocument((event) => publishDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument(publishDiagnostics),
  );

  for (const document of vscode.workspace.textDocuments) {
    publishDiagnostics(document);
  }
}

module.exports = { activate };
